import "server-only";
import { randomBytes } from "node:crypto";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hashToken, type CurrentUser } from "@/lib/auth/session";
import type { Permission, RoleCode } from "@/lib/auth/permissions";

/** Versión del protocolo de sincronización; el teléfono la manda en `X-Sync-Protocol`. */
export const SYNC_PROTOCOL = 1;

export const newDeviceToken = () => randomBytes(32).toString("base64url");

const userInclude = { role: { include: { permissions: { include: { permission: true } } } } } as const;

/** CurrentUser a partir del usuario de BD (mismos campos que la sesión web). */
export async function loadCurrentUser(userId: string): Promise<CurrentUser | null> {
  const u = await db.user.findUnique({ where: { id: userId }, include: userInclude });
  if (!u || !u.active || !u.mobileAccess) return null;
  return {
    id: u.id, name: u.name, email: u.email, role: u.role.code as RoleCode, roleName: u.role.name,
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.code as Permission)),
  };
}

/**
 * Autentica una petición de la app móvil: `Authorization: Bearer <token>` + `X-Sync-Protocol`.
 * Lanza AppError UNAUTHENTICATED (token inválido o revocado) o FORBIDDEN (usuario
 * ya no está activo o perdió el acceso móvil. Valida contra la BD en cada petición.
 */
export async function authenticateDevice(req: Request): Promise<{ device: Device; user: CurrentUser }> {
  const proto = req.headers.get("x-sync-protocol");
  if (proto !== String(SYNC_PROTOCOL)) throw new AppError("Actualiza la app para seguir sincronizando.", "CONFLICT");
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) throw new AppError("Sesión del dispositivo inválida.", "UNAUTHENTICATED");
  const device = await db.device.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!device || device.revokedAt) throw new AppError("Dispositivo revocado o desconocido.", "UNAUTHENTICATED");
  const user = await loadCurrentUser(device.userId);
  if (!user) throw new AppError("Tu usuario no tiene acceso a la app móvil.", "FORBIDDEN");
  if (!device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > 60_000)
    await db.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return { device, user };
}
