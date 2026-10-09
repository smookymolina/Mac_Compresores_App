import "server-only";
import { db } from "@/lib/db";
import type { Permission } from "@/lib/auth/permissions";

export interface NotificationInput {
  kind: string;
  title: string;
  body?: string;
  href?: string;
  /** Si se indica, el aviso se crea una sola vez por usuario con esta clave. */
  dedupeKey?: string;
}

/** Crea el aviso para cada usuario; con dedupeKey, los repetidos se ignoran. Devuelve cuántos se crearon. */
export async function notify(userIds: string[], n: NotificationInput) {
  if (userIds.length === 0) return 0;
  const res = await db.notification.createMany({
    data: [...new Set(userIds)].map((userId) => ({
      userId, kind: n.kind, title: n.title, body: n.body, href: n.href,
      dedupeKey: n.dedupeKey ? `${n.dedupeKey}:${userId}` : undefined,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/** Usuarios activos cuyo rol tiene alguno de los permisos indicados. */
export async function usersWithPermission(...anyOf: Permission[]) {
  return db.user.findMany({
    where: { active: true, role: { permissions: { some: { permission: { code: { in: anyOf } } } } } },
    select: { id: true, name: true, email: true },
  });
}

export async function listNotifications(userId: string, take = 20) {
  const [items, unread] = await Promise.all([
    db.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take }),
    db.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items, unread };
}

export async function markRead(userId: string, id?: string) {
  await db.notification.updateMany({ where: { userId, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date() } });
}

/** Limpieza (trabajo diario): avisos leídos con más de 90 días. */
export async function purgeOld() {
  const before = new Date(Date.now() - 90 * 864e5);
  return (await db.notification.deleteMany({ where: { readAt: { not: null }, createdAt: { lt: before } } })).count;
}
