import "server-only";
import { db } from "@/lib/db";

export interface UserUsage {
  id: string;
  name: string;
  role: string;
  active: boolean;
  lastSeenAt: Date | null;
  logins: number;
  actions: number;
  activeDays: number;
  quotes: number;
  sales: number;
  topAction: string | null;
}

/** Uso de la app por usuario en los últimos `days` días (auditoría, cotizaciones y ventas). Solo para admin. */
export async function getUsage(days = 30): Promise<UserUsage[]> {
  const since = new Date(Date.now() - days * 864e5);
  const [users, audit, top, quotes, sales] = await Promise.all([
    db.user.findMany({ select: { id: true, name: true, active: true, lastSeenAt: true, role: { select: { name: true } } } }),
    db.$queryRaw<{ userId: string; logins: bigint; actions: bigint; days: bigint; last: Date }[]>`
      SELECT "userId",
        count(*) FILTER (WHERE action = 'auth.login') AS logins,
        count(*) FILTER (WHERE action NOT LIKE 'auth.%') AS actions,
        count(DISTINCT ("createdAt" AT TIME ZONE 'America/Mexico_City')::date) AS days,
        max("createdAt") AS last
      FROM "AuditLog" WHERE "createdAt" >= ${since} AND "userId" IS NOT NULL GROUP BY "userId"`,
    db.$queryRaw<{ userId: string; action: string }[]>`
      SELECT DISTINCT ON ("userId") "userId", action FROM "AuditLog"
      WHERE "createdAt" >= ${since} AND "userId" IS NOT NULL AND action NOT LIKE 'auth.%'
      GROUP BY "userId", action ORDER BY "userId", count(*) DESC`,
    db.quote.groupBy({ by: ["sellerId"], where: { createdAt: { gte: since } }, _count: true }),
    db.sale.groupBy({ by: ["sellerId"], where: { confirmedAt: { gte: since } }, _count: true }),
  ]);
  const a = new Map(audit.map((r) => [r.userId, r]));
  const t = new Map(top.map((r) => [r.userId, r.action]));
  const q = new Map(quotes.map((r) => [r.sellerId, r._count]));
  const s = new Map(sales.map((r) => [r.sellerId, r._count]));
  return users
    .map((u) => {
      const r = a.get(u.id);
      const last = [u.lastSeenAt, r?.last ?? null].filter((d): d is Date => !!d).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
      return {
        id: u.id, name: u.name, role: u.role.name, active: u.active, lastSeenAt: last,
        logins: Number(r?.logins ?? 0), actions: Number(r?.actions ?? 0), activeDays: Number(r?.days ?? 0),
        quotes: q.get(u.id) ?? 0, sales: s.get(u.id) ?? 0, topAction: t.get(u.id) ?? null,
      };
    })
    .sort((x, y) => (y.lastSeenAt?.getTime() ?? 0) - (x.lastSeenAt?.getTime() ?? 0));
}
