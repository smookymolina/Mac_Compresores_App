import "server-only";
import { z } from "zod";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { hashToken } from "@/lib/auth/session";
import { clear, hit, isLimited } from "@/lib/rate-limit";
import { verifyCredentials } from "@/modules/users/service";
import { loadCurrentUser, newDeviceToken } from "./device";

export const registerSchema = z.object({
  email: z.string().trim().email().max(200),
  password: z.string().min(1).max(200),
  deviceName: z.string().trim().min(1).max(100),
  platform: z.enum(["ANDROID", "IOS"]),
  appVersion: z.string().trim().min(1).max(30),
});

const REGISTER_MAX = 5;
const REGISTER_WINDOW_MS = 15 * 60_000;

/** Máximo `SyncChange.seq` actual (0 si no hay cambios). */
export async function currentServerSeq(): Promise<bigint> {
  const r = await db.syncChange.aggregate({ _max: { seq: true } });
  return r._max.seq ?? BigInt(0);
}

/** Alta de dispositivo con correo y contraseña; devuelve el token en claro una sola vez. */
export async function registerDevice(raw: unknown, ip: string) {
  const input = registerSchema.parse(raw);
  const email = input.email.toLowerCase();
  // Por correo (como el login web): con ip+correo bastaba rotar IP o X-Forwarded-For para evadir el límite.
  const rlKey = `sync-register:${email}`;
  if (await isLimited(rlKey, REGISTER_MAX)) throw new AppError("Demasiados intentos. Espera 15 minutos.", "FORBIDDEN");

  const found = await verifyCredentials(email, input.password);
  if (!found) {
    await hit(rlKey, REGISTER_WINDOW_MS);
    await audit({ userId: null, action: "auth.login_failed", entity: "User", data: { email, via: "mobile" } });
    throw new AppError("Correo o contraseña inválidos.", "UNAUTHENTICATED");
  }
  await clear(rlKey);
  const user = await loadCurrentUser(found.id);
  if (!user) throw new AppError("Tu usuario no tiene acceso a la app móvil.", "FORBIDDEN");

  const token = newDeviceToken();
  const serverSeq = await currentServerSeq();
  const device = await db.$transaction(async (tx) => {
    const d = await tx.device.create({
      data: { userId: user.id, name: input.deviceName, platform: input.platform, appVersion: input.appVersion, tokenHash: hashToken(token), lastSeenAt: new Date() },
    });
    await audit({ userId: user.id, action: "device.register", entity: "Device", entityId: d.id, data: { name: d.name, platform: d.platform, appVersion: d.appVersion, ip } }, tx);
    return d;
  });
  return {
    token, deviceId: device.id, serverSeq,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, roleName: user.roleName, permissions: [...user.permissions] },
  };
}

/** El propio dispositivo cierra sesión: queda revocado. */
export async function logoutDevice(device: Device) {
  await db.$transaction(async (tx) => {
    const r = await tx.device.updateMany({ where: { id: device.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: device.userId } });
    if (r.count) await audit({ userId: device.userId, action: "device.logout", entity: "Device", entityId: device.id }, tx);
  });
}
