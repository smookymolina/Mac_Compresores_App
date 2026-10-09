import { db } from "@/lib/db";
import { dec, type Dec } from "@/lib/money";
import { can, type CurrentUser } from "@/lib/auth/session";
import { lowStockCount } from "@/modules/inventory/service";
import { quoteScope } from "@/modules/quotes/service";
import { saleScope } from "@/modules/sales/service";
import { listReceivables } from "@/modules/payments/service";

const TZ = "America/Mexico_City";
const MONTHS = 12;

/** Venta neta por mes (zona de México), últimos 12 meses incluido el actual; meses sin venta en cero. */
async function monthlyNet(user: CurrentUser) {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (MONTHS - 1), 1));
  const own = can(user, "sales.read_all") ? null : user.id;
  const rows = await db.$queryRaw<{ m: string; net: string }[]>`
    SELECT to_char(date_trunc('month', "confirmedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${TZ}), 'YYYY-MM') AS m,
           SUM(subtotal - "discountTotal")::text AS net
    FROM "Sale"
    WHERE status = 'CONFIRMED' AND "confirmedAt" >= ${start} AND (${own}::uuid IS NULL OR "sellerId" = ${own}::uuid)
    GROUP BY 1`;
  const byMonth = new Map(rows.map((r) => [r.m, dec(r.net)]));
  return Array.from({ length: MONTHS }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
    const key = d.toISOString().slice(0, 7);
    return { key, label: new Intl.DateTimeFormat("es-MX", { month: "short", timeZone: "UTC" }).format(d).replace(".", ""), year: d.getUTCFullYear(), net: byMonth.get(key) ?? dec(0) };
  });
}

/** Conversión: de las cotizaciones creadas en 90 días y ya resueltas, cuántas terminaron en venta. */
async function conversion(user: CurrentUser) {
  const since = new Date(Date.now() - 90 * 864e5);
  const rows = await db.quote.groupBy({
    by: ["status"],
    where: { AND: [quoteScope(user), { createdAt: { gte: since }, status: { in: ["CONVERTED", "REJECTED", "EXPIRED", "CANCELLED"] } }] },
    _count: true,
  });
  const decided = rows.reduce((a, r) => a + r._count, 0);
  const won = rows.find((r) => r.status === "CONVERTED")?._count ?? 0;
  return { decided, won, rate: decided > 0 ? won / decided : null };
}

/** Meta vs. avance del periodo de comisiones vigente (hoy dentro de sus fechas). */
async function targets(user: CurrentUser) {
  const today = new Date();
  const period = await db.commissionPeriod.findFirst({
    where: { startDate: { lte: today }, endDate: { gte: today } },
    include: { targets: { include: { seller: { select: { id: true, name: true } } } } },
    orderBy: { startDate: "desc" },
  });
  if (!period) return null;
  const mine = can(user, "sales.read_all") ? period.targets : period.targets.filter((t) => t.sellerId === user.id);
  if (mine.length === 0) return null;
  const end = new Date(period.endDate.getTime() + 864e5);
  const sums = await db.sale.groupBy({
    by: ["sellerId"],
    where: { status: "CONFIRMED", confirmedAt: { gte: period.startDate, lt: end }, sellerId: { in: mine.map((t) => t.sellerId) } },
    _sum: { subtotal: true, discountTotal: true },
  });
  const bySeller = new Map(sums.map((s) => [s.sellerId, net(s._sum)]));
  return {
    period: period.name,
    rows: mine
      .map((t) => ({ name: t.seller.name, target: t.amount, actual: bySeller.get(t.sellerId) ?? dec(0) }))
      .sort((a, b) => a.name.localeCompare(b.name, "es")),
  };
}

export async function getDashboard(user: CurrentUser) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const salesWhere = { AND: [saleScope(user), { status: "CONFIRMED" as const, confirmedAt: { gte: monthStart } }] };
  const canSales = can(user, "sales.read_all") || can(user, "sales.read_own");
  const canQuotes = can(user, "quotes.read_all") || can(user, "quotes.read_own");

  const [salesAgg, openQuotes, quotesByStatus, lowStock, recentSales, bySeller] = await Promise.all([
    canSales ? db.sale.aggregate({ where: salesWhere, _sum: { subtotal: true, discountTotal: true, total: true }, _count: true }) : null,
    canQuotes ? db.quote.aggregate({ where: { AND: [quoteScope(user), { status: { in: ["DRAFT", "SENT", "ACCEPTED"] } }] }, _sum: { total: true }, _count: true }) : null,
    canQuotes ? db.quote.groupBy({ by: ["status"], where: quoteScope(user), _count: true }) : [],
    can(user, "inventory.read") ? lowStockCount() : null,
    canSales
      ? db.sale.findMany({ where: saleScope(user), include: { customer: { select: { legalName: true } } }, orderBy: { confirmedAt: "desc" }, take: 5 })
      : [],
    can(user, "sales.read_all")
      ? db.sale.groupBy({ by: ["sellerId"], where: salesWhere, _sum: { subtotal: true, discountTotal: true }, orderBy: { _sum: { subtotal: "desc" } } })
      : [],
  ]);

  const [monthly, conv, goal, receivables] = await Promise.all([
    canSales ? monthlyNet(user) : null,
    canQuotes ? conversion(user) : null,
    canSales ? targets(user) : null,
    canSales ? listReceivables(user) : null,
  ]);

  const sellerNames = new Map(
    (await db.user.findMany({ where: { id: { in: bySeller.map((s) => s.sellerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return {
    salesMonth: salesAgg ? { net: net(salesAgg._sum), total: salesAgg._sum.total, count: salesAgg._count } : null,
    openQuotes: openQuotes ? { total: openQuotes._sum.total, count: openQuotes._count } : null,
    quotesByStatus: quotesByStatus.map((q) => ({ status: q.status, count: q._count })),
    lowStock,
    recentSales,
    monthly,
    conversion: conv,
    targets: goal,
    receivables: receivables
      ? {
          pending: receivables.reduce((a, r) => a.add(r.balance), dec(0)),
          overdue: receivables.filter((r) => r.overdue).reduce((a, r) => a.add(r.balance), dec(0)),
          overdueCount: receivables.filter((r) => r.overdue).length,
        }
      : null,
    bySeller: bySeller
      .map((s) => ({ name: sellerNames.get(s.sellerId) ?? "—", net: net(s._sum) }))
      .sort((a, b) => b.net.comparedTo(a.net)),
  };
}

/** Venta neta = subtotal − descuentos (sin IVA). */
function net(sum: { subtotal: Dec | null; discountTotal: Dec | null }) {
  return dec(sum.subtotal).sub(dec(sum.discountTotal));
}
