import "server-only";
import type { PaymentMethod, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { dec, type Dec } from "@/lib/money";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { saleScope } from "@/modules/sales/service";

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  TRANSFER: "Transferencia", CASH: "Efectivo", CARD: "Tarjeta", CHECK: "Cheque", OTHER: "Otro",
};

/** Suma de pagos vigentes (no anulados). */
export const paidOf = (payments: { amount: Dec; voidedAt: Date | null }[]) =>
  payments.filter((p) => !p.voidedAt).reduce((a, p) => a.add(p.amount), dec(0));

/** Vencimiento de cobro = fecha de venta + días de crédito del cliente. */
export const dueDate = (confirmedAt: Date, termsDays: number) => new Date(confirmedAt.getTime() + termsDays * 864e5);

export async function listPayments(saleId: string) {
  return db.payment.findMany({ where: { saleId }, include: { createdBy: { select: { name: true } } }, orderBy: [{ paidAt: "asc" }, { createdAt: "asc" }] });
}

/** Saldo pagado por venta (para listas). */
export async function paidBySale(saleIds: string[]) {
  if (saleIds.length === 0) return new Map<string, Dec>();
  const rows = await db.payment.groupBy({ by: ["saleId"], where: { saleId: { in: saleIds }, voidedAt: null }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.saleId, dec(r._sum.amount)]));
}

export async function registerPayment(
  user: CurrentUser, saleId: string,
  input: { amount: string; paidAt: Date; method: PaymentMethod; reference?: string },
) {
  assertCan(user, "payments.write");
  const amount = dec(input.amount);
  if (amount.lte(0)) throw new AppError("El importe debe ser mayor a cero.");
  return db.$transaction(async (tx) => {
    // Bloquea la venta: dos pagos simultáneos no pueden rebasar el saldo.
    await tx.$queryRaw`SELECT id FROM "Sale" WHERE id = ${saleId}::uuid FOR UPDATE`;
    const sale = await tx.sale.findFirst({ where: { AND: [{ id: saleId }, saleScope(user)] }, include: { payments: true } });
    if (!sale) throw new AppError("Venta no encontrada.", "NOT_FOUND");
    if (sale.status !== "CONFIRMED") throw new AppError("Solo se registran pagos de ventas confirmadas.", "CONFLICT");
    const balance = sale.total.sub(paidOf(sale.payments));
    if (amount.gt(balance)) throw new AppError(`El importe rebasa el saldo pendiente (${balance.toFixed(2)}).`, "CONFLICT");
    const p = await tx.payment.create({
      data: { saleId, amount, paidAt: input.paidAt, method: input.method, reference: input.reference, createdById: user.id },
    });
    await audit({ userId: user.id, action: "payment.create", entity: "Sale", entityId: saleId,
      data: { paymentId: p.id, amount: amount.toString(), method: input.method } }, tx);
    return p;
  });
}

/** Anula un pago (no se borra): queda en el historial con motivo. */
export async function voidPayment(user: CurrentUser, paymentId: string, reason: string) {
  assertCan(user, "payments.write");
  const p = await db.payment.findUnique({ where: { id: paymentId }, select: { saleId: true } });
  if (!p) throw new AppError("Pago no encontrado.", "NOT_FOUND");
  const sale = await db.sale.findFirst({ where: { AND: [{ id: p.saleId }, saleScope(user)] }, select: { id: true } });
  if (!sale) throw new AppError("Pago no encontrado.", "NOT_FOUND");
  await db.$transaction(async (tx) => {
    const res = await tx.payment.updateMany({ where: { id: paymentId, voidedAt: null }, data: { voidedAt: new Date(), voidedById: user.id, voidReason: reason } });
    if (res.count === 0) throw new AppError("El pago ya estaba anulado.", "CONFLICT");
    await audit({ userId: user.id, action: "payment.void", entity: "Sale", entityId: p.saleId, data: { paymentId, reason } }, tx);
  });
  return p.saleId;
}

export interface Receivable {
  id: string; folio: number; customer: string; sellerId: string;
  total: Dec; paid: Dec; balance: Dec; confirmedAt: Date; due: Date; overdue: boolean;
}

/** Ventas confirmadas con saldo pendiente (dentro del alcance del usuario). */
export async function listReceivables(user: CurrentUser | null, today = new Date()): Promise<Receivable[]> {
  const where: Prisma.SaleWhereInput = { AND: [user ? saleScope(user) : {}, { status: "CONFIRMED" }] };
  const sales = await db.sale.findMany({
    where,
    select: {
      id: true, folio: true, total: true, confirmedAt: true, sellerId: true,
      customer: { select: { legalName: true, paymentTermsDays: true } },
      payments: { select: { amount: true, voidedAt: true } },
    },
    orderBy: { confirmedAt: "asc" },
  });
  return sales
    .map((s) => {
      const paid = paidOf(s.payments);
      const due = dueDate(s.confirmedAt, s.customer.paymentTermsDays);
      return { id: s.id, folio: s.folio, customer: s.customer.legalName, sellerId: s.sellerId, total: s.total, paid,
        balance: s.total.sub(paid), confirmedAt: s.confirmedAt, due, overdue: due < today };
    })
    .filter((r) => r.balance.gt(0));
}
