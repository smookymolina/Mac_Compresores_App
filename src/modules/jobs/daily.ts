import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isMailConfigured, sendMail } from "@/lib/mail";
import type { Prisma } from "@prisma/client";
import { dec, fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { purgeExpired } from "@/lib/rate-limit";
import { notify, purgeOld, usersWithPermission } from "@/modules/notifications/service";
import { listReceivables } from "@/modules/payments/service";
import { calculatePeriod } from "@/modules/commissions/service";
import { canTransition } from "@/modules/quotes/status";
import { FOLLOWUP } from "./followup-config";

const TZ = "America/Mexico_City";
const REMIND_DAYS = 3;

/** Fecha de hoy en la Ciudad de México como medianoche UTC (así se guardan las fechas de vigencia). */
export function todayMx(now = new Date()) {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return { ymd, date: new Date(`${ymd}T00:00:00Z`) };
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function mail(to: string, subject: string, lines: string[]) {
  if (!isMailConfigured()) return;
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "") ?? "";
  await sendMail({
    to, subject,
    text: `${lines.join("\n")}\n\n${base}`,
    html: `${lines.map((l) => `<p>${escapeHtml(l)}</p>`).join("")}${base ? `<p><a href="${base}">${escapeHtml(base)}</a></p>` : ""}`,
  }).catch((e) => console.error("[mail] trabajo diario:", e instanceof Error ? e.message : e));
}

/** Enviadas cuya vigencia ya pasó → «Vencida» (UPDATE condicionado por estado; auditoría por cotización). */
async function expireQuotes(today: Date) {
  const due = await db.quote.findMany({ where: { status: "SENT", validUntil: { lt: today } }, select: { id: true, folio: true, sellerId: true } });
  let expired = 0;
  for (const q of due) {
    const ok = await db.$transaction(async (tx) => {
      const res = await tx.quote.updateMany({ where: { id: q.id, status: "SENT" }, data: { status: "EXPIRED" } });
      if (res.count === 0) return false;
      await audit({ userId: null, action: "quote.status", entity: "Quote", entityId: q.id, data: { from: "SENT", to: "EXPIRED", auto: true } }, tx);
      return true;
    });
    if (!ok) continue;
    expired++;
    await notify([q.sellerId], { kind: "quote.expired", title: `La cotización C-${q.folio} venció`, href: `/cotizaciones/${q.id}`, dedupeKey: `quote-expired:${q.id}` });
  }
  return expired;
}

/** Aviso al vendedor de cotizaciones enviadas que vencen en los próximos días (una vez por cotización). */
async function remindExpiring(today: Date) {
  const until = new Date(today.getTime() + REMIND_DAYS * 864e5);
  const soon = await db.quote.findMany({
    where: { status: "SENT", validUntil: { gte: today, lte: until } },
    select: { id: true, folio: true, validUntil: true, total: true, customer: { select: { legalName: true } }, seller: { select: { id: true, email: true, active: true } } },
  });
  let sent = 0;
  for (const q of soon) {
    const title = `La cotización C-${q.folio} vence el ${fmtDate(q.validUntil)}`;
    const created = await notify([q.seller.id], { kind: "quote.expiring", title, body: `${q.customer.legalName} · ${fmtMoney(q.total)}`, href: `/cotizaciones/${q.id}`, dedupeKey: `quote-expiring:${q.id}` });
    if (created > 0 && q.seller.active) {
      sent++;
      await mail(q.seller.email, `${title} · MAC Compresores`, [title + ".", `Cliente: ${q.customer.legalName}. Total: ${fmtMoney(q.total)}.`, "Da seguimiento con el cliente antes de que venza."]);
    }
  }
  return sent;
}

const DAY = 864e5;
/** Días calendario (CDMX) transcurridos desde `since` hasta `today`. */
const daysSince = (today: Date, since: Date) => Math.round((today.getTime() - todayMx(since).date.getTime()) / DAY);
const isBig = (total: Prisma.Decimal) => dec(total).gte(dec(FOLLOWUP.adminAmountThreshold));
type FollowQuote = { id: string; folio: number; total: Prisma.Decimal; updatedAt: Date; customer: { legalName: string }; seller: { id: string; email: string; active: boolean } };
const followSelect = { id: true, folio: true, total: true, updatedAt: true, customer: { select: { legalName: true } }, seller: { select: { id: true, email: true, active: true } } } as const;

/** Borradores con ≥10 días sin movimiento → «Cancelada» (motivo ABANDONED) y aviso al vendedor. */
async function cancelAbandonedDrafts(today: Date) {
  if (!canTransition("DRAFT", "CANCELLED")) return 0;
  const stale = await db.quote.findMany({ where: { status: "DRAFT", updatedAt: { lt: new Date(today.getTime() - (FOLLOWUP.draftCancelDays - 1) * DAY) } }, select: followSelect });
  let n = 0;
  for (const q of stale) {
    if (daysSince(today, q.updatedAt) < FOLLOWUP.draftCancelDays) continue;
    const ok = await db.$transaction(async (tx) => {
      // Guarda: sigue en borrador y sin movimiento desde la lectura.
      const res = await tx.quote.updateMany({
        where: { id: q.id, status: "DRAFT", updatedAt: q.updatedAt },
        data: { status: "CANCELLED", lostReason: "ABANDONED", lostNote: `Cancelada automáticamente: borrador sin movimiento por ${FOLLOWUP.draftCancelDays} días` },
      });
      if (res.count === 0) return false;
      await audit({ userId: null, action: "quote.status", entity: "Quote", entityId: q.id, data: { from: "DRAFT", to: "CANCELLED", auto: true, lostReason: "ABANDONED" } }, tx);
      return true;
    });
    if (!ok) continue;
    n++;
    const title = `La cotización C-${q.folio} se canceló por inactividad`;
    const created = await notify([q.seller.id], { kind: "quote.abandoned", title, body: `${q.customer.legalName} · ${fmtMoney(q.total)} · borrador sin movimiento por ${FOLLOWUP.draftCancelDays} días`, href: `/cotizaciones/${q.id}`, dedupeKey: `quote-abandoned:${q.id}` });
    if (created > 0 && q.seller.active) await mail(q.seller.email, `${title} · MAC Compresores`, [title + ".", `Cliente: ${q.customer.legalName}. Total: ${fmtMoney(q.total)}.`]);
  }
  return n;
}

/** Avisa al vendedor y (por antigüedad o monto) a administradores; un solo aviso por cotización y etapa. */
async function followupNotify(q: FollowQuote, key: string, kind: string, title: string, days: number, sellerDays: number, adminDays: number, admins: { id: string; email: string }[]) {
  let sent = 0;
  const body = `${q.customer.legalName} · ${fmtMoney(q.total)} · ${days} días`;
  const lines = [title + ".", `Cliente: ${q.customer.legalName}. Total: ${fmtMoney(q.total)}.`];
  const href = `/cotizaciones/${q.id}`;
  if (days >= sellerDays) {
    const created = await notify([q.seller.id], { kind, title, body, href, dedupeKey: `${key}:seller:${q.id}:${todayMx(q.updatedAt).ymd}` });
    if (created > 0 && q.seller.active) { sent++; await mail(q.seller.email, `${title} · MAC Compresores`, lines); }
  }
  // Umbral: total >= $500 000 MXN escala a administradores desde el primer aviso; las demás a los `adminDays`.
  if (days >= (isBig(q.total) ? sellerDays : adminDays)) {
    for (const a of admins) {
      if (a.id === q.seller.id) continue;
      const created = await notify([a.id], { kind, title: `${title} (${q.customer.legalName})`, body, href, dedupeKey: `${key}:admin:${q.id}:${todayMx(q.updatedAt).ymd}` });
      if (created > 0) { sent++; await mail(a.email, `${title} · MAC Compresores`, lines); }
    }
  }
  return sent;
}

/** Borradores sin movimiento: vendedor a los 2 días, administradores a los 5 (o 2 si el monto supera el umbral). */
async function remindStaleDrafts(today: Date) {
  const drafts = await db.quote.findMany({ where: { status: "DRAFT", updatedAt: { lt: new Date(today.getTime() - (FOLLOWUP.draftSellerDays - 1) * DAY) } }, select: followSelect });
  if (drafts.length === 0) return 0;
  const admins = await usersWithPermission("quotes.approve_discount");
  let n = 0;
  for (const q of drafts) {
    const days = daysSince(today, q.updatedAt);
    if (days < FOLLOWUP.draftSellerDays) continue;
    n += await followupNotify(q, `draft-stale`, "followup.draft", `La cotización C-${q.folio} lleva ${days} días en borrador`, days, FOLLOWUP.draftSellerDays, FOLLOWUP.draftAdminDays, admins);
  }
  return n;
}

/** Aceptadas sin venta (updatedAt = fecha de aceptación): vendedor a los 2 días, administradores a los 5 (o 2 por monto). */
async function remindAcceptedNoSale(today: Date) {
  const list = await db.quote.findMany({ where: { status: "ACCEPTED", sale: null, updatedAt: { lt: new Date(today.getTime() - (FOLLOWUP.acceptedSellerDays - 1) * DAY) } }, select: followSelect });
  if (list.length === 0) return 0;
  const admins = await usersWithPermission("quotes.approve_discount");
  let n = 0;
  for (const q of list) {
    const days = daysSince(today, q.updatedAt);
    if (days < FOLLOWUP.acceptedSellerDays) continue;
    n += await followupNotify(q, `accepted-stale`, "followup.accepted", `La cotización C-${q.folio} lleva ${days} días aceptada sin venta`, days, FOLLOWUP.acceptedSellerDays, FOLLOWUP.acceptedAdminDays, admins);
  }
  return n;
}

/** Resumen diario: un correo y un aviso por vendedor con pendientes; un resumen global para administradores. */
async function followupSummaries(today: Date, ymd: string) {
  const until = new Date(today.getTime() + REMIND_DAYS * DAY);
  const [drafts, sent, accepted] = await Promise.all([
    db.quote.findMany({ where: { status: "DRAFT" }, select: followSelect }),
    db.quote.findMany({ where: { status: "SENT", validUntil: { gte: today, lte: until } }, select: { ...followSelect, validUntil: true } }),
    db.quote.findMany({ where: { status: "ACCEPTED", sale: null }, select: followSelect }),
  ]);
  type Line = { sellerId: string; sellerName: string; text: string };
  const lines: Line[] = [];
  const names = new Map((await db.user.findMany({ where: { id: { in: [...new Set([...drafts, ...sent, ...accepted].map((q) => q.seller.id))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const put = (q: FollowQuote, label: string) => lines.push({ sellerId: q.seller.id, sellerName: names.get(q.seller.id) ?? "—", text: `C-${q.folio} · ${q.customer.legalName} · ${fmtMoney(q.total)} · ${label}` });
  for (const q of drafts) put(q, `borrador, ${daysSince(today, q.updatedAt)} días sin movimiento`);
  for (const q of sent) put(q, `enviada, vence el ${fmtDate(q.validUntil)}`);
  for (const q of accepted) put(q, `aceptada sin venta, ${daysSince(today, q.updatedAt)} días`);
  if (lines.length === 0) return 0;

  const admins = await usersWithPermission("quotes.approve_discount");
  const adminIds = new Set(admins.map((a) => a.id));
  let n = 0;
  const deliver = async (u: { id: string; email: string; active?: boolean }, title: string, body: string[], active: boolean) => {
    const created = await notify([u.id], { kind: "followup.summary", title, body: body[0], href: "/cotizaciones", dedupeKey: `followup-summary:${ymd}:${u.id}` });
    if (created > 0 && active) { n++; await mail(u.email, `${title} · MAC Compresores`, [title + ":", ...body.slice(0, 60), ...(body.length > 60 ? [`…y ${body.length - 60} más.`] : [])]); }
  };
  // Vendedores (no administradores): solo lo suyo.
  const bySeller = new Map<string, Line[]>();
  for (const l of lines) bySeller.set(l.sellerId, [...(bySeller.get(l.sellerId) ?? []), l]);
  const sellers = await db.user.findMany({ where: { id: { in: [...bySeller.keys()] }, active: true }, select: { id: true, email: true } });
  for (const s of sellers) {
    if (adminIds.has(s.id)) continue;
    const mine = bySeller.get(s.id)!;
    await deliver(s, `Seguimiento: ${mine.length} cotizacion${mine.length === 1 ? "" : "es"} pendiente${mine.length === 1 ? "" : "s"}`, mine.map((l) => l.text), true);
  }
  // Administradores: un resumen global agrupado por vendedor (también para quien además es vendedor).
  if (admins.length > 0) {
    const body: string[] = [];
    for (const ls of bySeller.values()) body.push(`${ls[0].sellerName} (${ls.length}):`, ...ls.map((l) => `  ${l.text}`));
    for (const a of admins) await deliver(a, `Seguimiento: ${lines.length} cotizacion${lines.length === 1 ? "" : "es"} pendiente${lines.length === 1 ? "" : "s"} del equipo`, body, true);
  }
  return n;
}

/** Resumen diario de productos en o bajo su stock mínimo para quien gestiona inventario. */
async function stockAlerts(ymd: string) {
  const low = await db.$queryRaw<{ sku: string; description: string; warehouse: string; quantity: string; minStock: string }[]>`
    SELECT p.sku, p.description, w.name AS warehouse, b.quantity::text AS quantity, b."minStock"::text AS "minStock"
    FROM "StockBalance" b JOIN "Product" p ON p.id = b."productId" JOIN "Warehouse" w ON w.id = b."warehouseId"
    WHERE b."minStock" > 0 AND b.quantity <= b."minStock" ORDER BY p.sku LIMIT 200`;
  if (low.length === 0) return 0;
  const users = await usersWithPermission("inventory.write");
  const title = `${low.length} producto${low.length === 1 ? "" : "s"} en o bajo su stock mínimo`;
  for (const u of users) {
    const created = await notify([u.id], { kind: "stock.low", title, href: "/inventario?low=1", dedupeKey: `stock-low:${ymd}` });
    if (created > 0) {
      await mail(u.email, `${title} · MAC Compresores`, [
        `${title}:`,
        ...low.slice(0, 50).map((r) => `${r.sku} · ${r.description} · ${r.warehouse}: ${r.quantity} (mín. ${r.minStock})`),
        ...(low.length > 50 ? [`…y ${low.length - 50} más.`] : []),
      ]);
    }
  }
  return low.length;
}

/** Aviso diario de ventas con cobro vencido para quien registra pagos. */
async function overdueAlerts(ymd: string, now: Date) {
  const overdue = (await listReceivables(null, now)).filter((r) => r.overdue);
  if (overdue.length === 0) return 0;
  const total = overdue.reduce((a, r) => a.add(r.balance), dec(0));
  const users = await usersWithPermission("payments.write");
  await notify(users.map((u) => u.id), {
    kind: "receivables.overdue", title: `${overdue.length} venta${overdue.length === 1 ? "" : "s"} con cobro vencido`,
    body: `Saldo vencido: ${fmtMoney(total)}`, href: "/cobranza?vencidas=1", dedupeKey: `overdue:${ymd}`,
  });
  return overdue.length;
}

/** Las ventas y cobros pasan solos a Comisiones: recalcula periodos abiertos sin nada aprobado. */
async function recalcOpenCommissions(today: Date) {
  const open = await db.commissionPeriod.findMany({
    where: { status: "OPEN", startDate: { lte: today }, entries: { none: { status: { not: "CALCULATED" } } } },
    select: { id: true },
  });
  let n = 0;
  for (const p of open) {
    try { await calculatePeriod(null, p.id); n++; } catch (e) {
      console.error("[job] comisiones:", e instanceof Error ? e.message : e);
    }
  }
  return n;
}

export async function runDailyJob(now = new Date()) {
  const { ymd, date } = todayMx(now);
  const result = {
    day: ymd,
    expiredQuotes: await expireQuotes(date),
    expiringReminders: await remindExpiring(date),
    abandonedDrafts: await cancelAbandonedDrafts(date),
    staleDraftReminders: await remindStaleDrafts(date),
    acceptedReminders: await remindAcceptedNoSale(date),
    followupSummaries: await followupSummaries(date, ymd),
    lowStock: await stockAlerts(ymd),
    overdueSales: await overdueAlerts(ymd, now),
    purgedRateLimits: await purgeExpired(),
    purgedNotifications: await purgeOld(),
    commissionPeriods: await recalcOpenCommissions(date),
  };
  await audit({ userId: null, action: "job.daily", entity: "System", data: result });
  return result;
}
