import { db } from "@/lib/db";
import { dec, type Dec } from "@/lib/money";
import { can, type CurrentUser } from "@/lib/auth/session";
import { lowStockCount } from "@/modules/inventory/service";
import { quoteScope } from "@/modules/quotes/service";
import { saleScope } from "@/modules/sales/service";

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

  const sellerNames = new Map(
    (await db.user.findMany({ where: { id: { in: bySeller.map((s) => s.sellerId) } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );

  return {
    salesMonth: salesAgg ? { net: net(salesAgg._sum), total: salesAgg._sum.total, count: salesAgg._count } : null,
    openQuotes: openQuotes ? { total: openQuotes._sum.total, count: openQuotes._count } : null,
    quotesByStatus: quotesByStatus.map((q) => ({ status: q.status, count: q._count })),
    lowStock,
    recentSales,
    bySeller: bySeller
      .map((s) => ({ name: sellerNames.get(s.sellerId) ?? "—", net: net(s._sum) }))
      .sort((a, b) => b.net.comparedTo(a.net)),
  };
}

/** Venta neta = subtotal − descuentos (sin IVA). */
function net(sum: { subtotal: Dec | null; discountTotal: Dec | null }) {
  return dec(sum.subtotal).sub(dec(sum.discountTotal));
}
