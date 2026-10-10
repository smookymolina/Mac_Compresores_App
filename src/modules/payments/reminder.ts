import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { renderEmail, type EmailDetail } from "@/lib/email-layout";
import { fmtMoney, type Dec } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { saleScope } from "@/modules/sales/service";
import { dueDate, paidOf } from "./service";

/**
 * Recordatorio de pago pendiente al cliente (solo envío manual desde Cobranza o el detalle de la venta).
 * Límite: 1 recordatorio por venta cada 12 h, comprobado con la bitácora (AuditLog, acción «payment.reminder»).
 */

export const REMINDER_ACTION = "payment.reminder";
export const REMINDER_COOLDOWN_MS = 12 * 3600e3;
const DAY_MS = 864e5;

/** Datos bancarios de BANK_INFO («Banco: …|Titular: …|Cuenta: …|CLABE: …»), igual que el PDF de cotización. */
export const bankInfoLines = (raw = process.env.BANK_INFO) =>
  (raw ?? "").split("|").map((l) => l.trim()).filter(Boolean).slice(0, 8);

/** Días completos de atraso respecto al vencimiento (0 si aún no vence). */
export const overdueDays = (due: Date, today = new Date()) => Math.max(0, Math.floor((today.getTime() - due.getTime()) / DAY_MS));

/** Destinatario sugerido: correo del cliente o, si no tiene, el del primer contacto con correo. */
export const reminderRecipient = (c: { email: string | null; contacts: { email: string | null }[] }) =>
  c.email?.trim() || c.contacts.find((x) => x.email?.trim())?.email?.trim() || "";

export interface ReminderFacts {
  folio: number;
  customer: string;
  total: Dec;
  paid: Dec;
  balance: Dec;
  due: Date;
  today?: Date;
}

/** Mensaje editable que se prellena en el modal (el usuario puede cambiarlo antes de enviar). */
export function defaultReminderMessage(f: ReminderFacts) {
  const late = overdueDays(f.due, f.today);
  const status = late > 0
    ? `venció el ${fmtDate(f.due)} (${late} ${late === 1 ? "día" : "días"} de atraso)`
    : `vence el ${fmtDate(f.due)}`;
  return [
    `Le escribimos para recordarle, de la manera más atenta, que la venta V-${f.folio} tiene un saldo pendiente de ${fmtMoney(f.balance)}, cuyo plazo de pago ${status}.`,
    "Le agradeceremos realizar el pago a la brevedad. Si ya lo efectuó, por favor responda a este correo con el comprobante para aplicarlo a su cuenta y disculpe la molestia.",
    "Quedamos a sus órdenes para cualquier duda o aclaración.",
  ].join("\n\n");
}

/** Arma el correo de marca (HTML + texto plano). */
export function buildReminderEmail(
  f: ReminderFacts & { message: string; seller: { name: string; email: string }; bank?: string[] },
) {
  const late = overdueDays(f.due, f.today);
  const details: EmailDetail[] = [
    { label: "Cliente", value: f.customer },
    { label: "Venta", value: `V-${f.folio}` },
    { label: "Total de la venta", value: fmtMoney(f.total) },
    { label: "Pagado", value: fmtMoney(f.paid) },
    { label: "Saldo pendiente", value: fmtMoney(f.balance) },
    { label: "Fecha de vencimiento", value: fmtDate(f.due) },
    ...(late > 0 ? [{ label: "Días de atraso", value: String(late) }] : []),
  ];
  const bank = f.bank ?? bankInfoLines();
  const subject = `Recordatorio de pago · Venta V-${f.folio} · MAC Compresores`;
  const { html, text } = renderEmail({
    preheader: `Saldo pendiente de ${fmtMoney(f.balance)} de la venta V-${f.folio}.`,
    eyebrow: "Recordatorio de pago",
    title: `Saldo pendiente de la venta V-${f.folio}`,
    greeting: `Estimados ${f.customer}:`,
    paragraphs: f.message.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean),
    details,
    notes: [
      ...(bank.length ? [`Datos para su pago por transferencia:\n${bank.join("\n")}`] : []),
      `Al pagar, indique la referencia V-${f.folio}. Si ya realizó el pago, le pedimos ignorar este mensaje.`,
    ],
    signature: ["Atentamente,", f.seller.name, "MAC Compresores", f.seller.email],
  });
  return { subject, html, text };
}

/** Fecha del último recordatorio por venta (para la lista de Cobranza). */
export async function lastRemindersBySale(saleIds: string[]) {
  if (saleIds.length === 0) return new Map<string, Date>();
  const rows = await db.auditLog.groupBy({
    by: ["entityId"],
    where: { action: REMINDER_ACTION, entity: "Sale", entityId: { in: saleIds } },
    _max: { createdAt: true },
  });
  return new Map(rows.filter((r) => r.entityId && r._max.createdAt).map((r) => [r.entityId!, r._max.createdAt!]));
}

/** Cuándo vuelve a estar permitido enviar (null = ya se puede). */
export const nextReminderAt = (last: Date | null | undefined, now = new Date()) => {
  if (!last) return null;
  const next = new Date(last.getTime() + REMINDER_COOLDOWN_MS);
  return next > now ? next : null;
};

/** Datos prellenados del modal de recordatorio (serializables para el cliente). */
export interface ReminderDraft {
  to: string;
  message: string;
  lastSentAt: string | null;
  nextAllowedAt: string | null;
}

export function reminderDraft(
  f: ReminderFacts & { customerContact: { email: string | null; contacts: { email: string | null }[] }; lastSentAt?: Date | null },
): ReminderDraft {
  const next = nextReminderAt(f.lastSentAt, f.today);
  return {
    to: reminderRecipient(f.customerContact),
    message: defaultReminderMessage(f),
    lastSentAt: f.lastSentAt ? f.lastSentAt.toISOString() : null,
    nextAllowedAt: next ? next.toISOString() : null,
  };
}

/** Promesa con tiempo límite: el envío ocurre dentro de una transacción que no debe quedar abierta. */
function withTimeout<T>(p: Promise<T>, ms: number) {
  let t: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, reject) => { t = setTimeout(() => reject(new Error(`tiempo de espera agotado (${ms} ms)`)), ms); }),
  ]).finally(() => clearTimeout(t));
}

/**
 * Envía el recordatorio. Reply-To = vendedor de la venta. Un candado consultivo por venta serializa envíos
 * simultáneos para que el límite de 12 h no se pueda saltar con dos clics; si el correo falla no queda registro.
 */
export async function sendPaymentReminder(
  user: CurrentUser, saleId: string, input: { to: string[]; cc: string[]; message: string },
) {
  assertCan(user, "payments.write");
  if (!isMailConfigured()) throw new AppError("El envío de correos no está configurado. Contacta al administrador.");

  const sale = await db.sale.findFirst({
    where: { AND: [{ id: saleId }, saleScope(user)] }, // control de acceso por objeto
    select: {
      id: true, folio: true, status: true, total: true, confirmedAt: true,
      customer: { select: { legalName: true, paymentTermsDays: true } },
      seller: { select: { name: true, email: true } },
      payments: { select: { amount: true, voidedAt: true } },
    },
  });
  if (!sale) throw new AppError("Venta no encontrada.", "NOT_FOUND");
  if (sale.status !== "CONFIRMED") throw new AppError("Solo se envían recordatorios de ventas confirmadas.", "CONFLICT");
  const paid = paidOf(sale.payments);
  const balance = sale.total.sub(paid);
  if (balance.lte(0)) throw new AppError("La venta no tiene saldo pendiente.", "CONFLICT");

  const facts: ReminderFacts = {
    folio: sale.folio, customer: sale.customer.legalName, total: sale.total, paid, balance,
    due: dueDate(sale.confirmedAt, sale.customer.paymentTermsDays),
  };
  const mail = buildReminderEmail({ ...facts, message: input.message, seller: sale.seller });

  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${REMINDER_ACTION}:${saleId}`}::text))`;
    const last = await tx.auditLog.findFirst({
      where: { action: REMINDER_ACTION, entity: "Sale", entityId: saleId },
      orderBy: { createdAt: "desc" }, select: { createdAt: true },
    });
    const next = nextReminderAt(last?.createdAt);
    if (next) {
      throw new AppError(
        `Ya se envió un recordatorio el ${fmtDateTime(last!.createdAt)}. Podrás enviar otro a partir del ${fmtDateTime(next)}.`,
        "CONFLICT",
      );
    }
    try {
      await withTimeout(sendMail({
        to: input.to, cc: input.cc.length ? input.cc : undefined, replyTo: sale.seller.email,
        subject: mail.subject, html: mail.html, text: mail.text,
      }), 40_000);
    } catch (e) {
      console.error("[mail] recordatorio:", e instanceof Error ? e.message : e);
      throw new AppError("No se pudo enviar el correo. Revisa la dirección e inténtalo de nuevo.");
    }
    await audit({
      userId: user.id, action: REMINDER_ACTION, entity: "Sale", entityId: saleId,
      data: { to: input.to, cc: input.cc, balance: balance.toString() },
    }, tx);
  }, { maxWait: 10_000, timeout: 60_000 });
}

/**
 * Borradores del modal para las filas de Cobranza: destinatario sugerido, mensaje, último envío y Reply-To.
 * Las filas ya vienen filtradas por el alcance del usuario (listReceivables).
 */
export async function reminderDraftsFor(
  rows: { id: string; folio: number; customer: string; total: Dec; paid: Dec; balance: Dec; due: Date }[],
  today = new Date(),
) {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return new Map<string, ReminderDraft & { replyTo: string }>();
  const [sales, last] = await Promise.all([
    db.sale.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        seller: { select: { email: true } },
        customer: { select: { email: true, contacts: { select: { email: true } } } },
      },
    }),
    lastRemindersBySale(ids),
  ]);
  const byId = new Map(sales.map((s) => [s.id, s]));
  const out = new Map<string, ReminderDraft & { replyTo: string }>();
  for (const r of rows) {
    const s = byId.get(r.id);
    if (!s) continue;
    out.set(r.id, {
      ...reminderDraft({ ...r, today, customerContact: s.customer, lastSentAt: last.get(r.id) ?? null }),
      replyTo: s.seller.email,
    });
  }
  return out;
}
