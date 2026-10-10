import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma, TokenPurpose } from "@prisma/client";

/** En BD solo se guarda el SHA-256; el token en claro solo viaja en el correo (nunca en logs ni auditoría). */
export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** URL pública de la app. Se toma de APP_URL (nunca del Host de la petición, que el cliente controla). */
export function appUrl() {
  const url = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new Error("Falta la variable de entorno APP_URL");
  return url;
}

/**
 * Emite un token de un solo uso para `purpose`. Invalida los pendientes del mismo tipo:
 * solo el enlace más reciente sirve. Devuelve el token en claro (para el enlace del correo).
 */
export async function issueToken(tx: Prisma.TransactionClient, userId: string, purpose: TokenPurpose, ttlMs: number) {
  const token = randomBytes(32).toString("base64url");
  await tx.passwordResetToken.deleteMany({ where: { userId, purpose, usedAt: null } });
  await tx.passwordResetToken.create({ data: { id: hashToken(token), userId, purpose, expiresAt: new Date(Date.now() + ttlMs) } });
  return token;
}

/** ¿El token existe, es del tipo indicado, no se ha usado y no ha vencido? */
export async function isTokenValid(db: Prisma.TransactionClient, token: string, purpose: TokenPurpose) {
  const t = await db.passwordResetToken.findUnique({ where: { id: hashToken(token) }, include: { user: { select: { active: true } } } });
  return !!t && t.purpose === purpose && !t.usedAt && t.expiresAt > new Date() && t.user.active;
}

/**
 * Consume el token (guarda de estado: un solo uso, del tipo correcto y vigente) y devuelve el userId.
 * Lanza `invalid()` si no procede.
 */
export async function claimToken(tx: Prisma.TransactionClient, token: string, purpose: TokenPurpose, invalid: () => Error) {
  const id = hashToken(token);
  const now = new Date();
  const claimed = await tx.passwordResetToken.updateMany({ where: { id, purpose, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
  if (claimed.count !== 1) throw invalid();
  const { userId } = await tx.passwordResetToken.findUniqueOrThrow({ where: { id } });
  return userId;
}
