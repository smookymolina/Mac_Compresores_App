import "server-only";
import { db } from "@/lib/db";
import type { Permission } from "@/lib/auth/permissions";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { renderEmail } from "@/lib/email-layout";

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

/**
 * Aviso en la app y también por correo a cada usuario activo (un correo por persona).
 * Si el correo no está configurado o falla, el aviso en la app se conserva y solo se registra el error.
 */
export async function notifyWithEmail(userIds: string[], n: NotificationInput & { eyebrow?: string }) {
  const created = await notify(userIds, n);
  if (!isMailConfigured() || userIds.length === 0) return created;
  const users = await db.user.findMany({ where: { id: { in: [...new Set(userIds)] }, active: true }, select: { name: true, email: true } });
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  const results = await Promise.allSettled(users.map((u) => sendMail({
    to: u.email,
    subject: `${n.title} · MAC Compresores`,
    ...renderEmail({
      preheader: n.body ?? n.title,
      eyebrow: n.eyebrow,
      title: n.title,
      greeting: `Hola ${u.name}:`,
      paragraphs: n.body ? [n.body] : [],
      cta: base && n.href ? { label: "Ver en el sistema", url: `${base}${n.href}` } : undefined,
      signature: ["MAC Compresores"],
    }),
  })));
  for (const r of results) if (r.status === "rejected") console.error("[mail] aviso:", r.reason instanceof Error ? r.reason.message : r.reason);
  return created;
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
