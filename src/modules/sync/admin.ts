import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";

/**
 * Activa o quita el acceso a la app móvil. Al quitarlo se revocan en la misma transacción
 * los dispositivos activos del usuario (su token deja de servir en la siguiente petición).
 */
export async function setMobileAccess(actor: CurrentUser, userId: string, enabled: boolean) {
  assertCan(actor, "users.manage");
  return db.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, mobileAccess: true } });
    if (!u) throw new AppError("Usuario no encontrado.", "NOT_FOUND");
    await tx.user.update({ where: { id: userId }, data: { mobileAccess: enabled } });
    let revoked = 0;
    if (!enabled) {
      ({ count: revoked } = await tx.device.updateMany({
        where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id },
      }));
    }
    await audit({ userId: actor.id, action: "user.mobile_access", entity: "User", entityId: userId,
      data: { from: u.mobileAccess, to: enabled, devicesRevoked: revoked } }, tx);
    return { revoked };
  });
}

/** Revoca un dispositivo. Guarda de estado: solo si sigue activo. */
export async function revokeDevice(actor: CurrentUser, deviceId: string) {
  assertCan(actor, "users.manage");
  await db.$transaction(async (tx) => {
    const { count } = await tx.device.updateMany({
      where: { id: deviceId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id },
    });
    if (count === 0) {
      const exists = await tx.device.findUnique({ where: { id: deviceId }, select: { id: true } });
      throw exists ? new AppError("El dispositivo ya estaba revocado.", "CONFLICT") : new AppError("Dispositivo no encontrado.", "NOT_FOUND");
    }
    await audit({ userId: actor.id, action: "device.revoke", entity: "Device", entityId: deviceId }, tx);
  });
}

export async function listDevices() {
  return db.device.findMany({
    select: {
      id: true, name: true, platform: true, appVersion: true, createdAt: true, lastSeenAt: true, revokedAt: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: { sort: "desc", nulls: "last" } }],
  });
}

/** Comandos rechazados o en conflicto que nadie ha revisado, más recientes primero. */
export async function listSyncIssues({ take = 100 }: { take?: number } = {}) {
  const items = await db.syncCommand.findMany({
    where: { status: { in: ["REJECTED", "CONFLICT"] }, resolvedAt: null },
    select: { id: true, type: true, status: true, error: true, capturedAt: true, receivedAt: true, userId: true, device: { select: { name: true } } },
    orderBy: { receivedAt: "desc" },
    take,
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return items.map((i) => ({ ...i, userName: names.get(i.userId) ?? null }));
}

/** Marca una incidencia como revisada. Guarda de estado: solo si sigue sin resolver. */
export async function resolveSyncIssue(actor: CurrentUser, id: string) {
  assertCan(actor, "users.manage");
  await db.$transaction(async (tx) => {
    const { count } = await tx.syncCommand.updateMany({
      where: { id, resolvedAt: null, status: { in: ["REJECTED", "CONFLICT"] } },
      data: { resolvedAt: new Date(), resolvedById: actor.id },
    });
    if (count === 0) throw new AppError("La incidencia no existe o ya fue revisada.", "CONFLICT");
    await audit({ userId: actor.id, action: "sync.issue_resolved", entity: "SyncCommand", entityId: id }, tx);
  });
}
