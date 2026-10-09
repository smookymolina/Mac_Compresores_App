import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { dec, fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { purgeExpired } from "@/lib/rate-limit";
import { notify, purgeOld, usersWithPermission } from "@/modules/notifications/service";
import { listReceivables } from "@/modules/payments/service";

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

export async function runDailyJob(now = new Date()) {
  const { ymd, date } = todayMx(now);
  const result = {
    day: ymd,
    expiredQuotes: await expireQuotes(date),
    expiringReminders: await remindExpiring(date),
    lowStock: await stockAlerts(ymd),
    overdueSales: await overdueAlerts(ymd, now),
    purgedRateLimits: await purgeExpired(),
    purgedNotifications: await purgeOld(),
  };
  await audit({ userId: null, action: "job.daily", entity: "System", data: result });
  return result;
}
