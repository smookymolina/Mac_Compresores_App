import "server-only";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { createGuardrails, generateSecret, generateURI, verifySync } from "otplib";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { clear, hit, isLimited } from "@/lib/rate-limit";
import { logPartnerActivity } from "./activity";
import { decryptSecret, encryptSecret } from "./crypto";
import { autoBlock } from "./guard";

export { encryptSecret, decryptSecret } from "./crypto";

export const MAX_FAILED_LOGINS = 5;
export const BACKUP_CODE_COUNT = 10;
export const TOTP_ISSUER = "MAC Compresores";
const LOGIN_WINDOW_MS = 15 * 60_000;
const BCRYPT_COST = 12;
const BACKUP_COST = 10;
/** Los secretos nuevos son de 20 bytes; se admiten desde 10 por compatibilidad con el socio demo del seed (JBSWY3DPEHPK3PXP). */
const GUARDRAILS = createGuardrails({ MIN_SECRET_BYTES: 10 });
/** Hash ficticio (válido) para igualar el tiempo de respuesta cuando el correo no existe. */
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("sin-socio", BCRYPT_COST));

type Ctx = { ip?: string | null; userAgent?: string | null };

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);

/** Contraseña temporal legible (sin 0/O/1/l/I). */
export function generateTempPassword(length = 14): string {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  return Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
}

/** Cuenta un fallo (contraseña o 2FA). Al 5.º consecutivo bloquea la cuenta. Devuelve true si quedó bloqueada. */
export async function registerFailure(partnerId: string, ctx: Ctx = {}): Promise<boolean> {
  const p = await db.partner.update({ where: { id: partnerId }, data: { failedLogins: { increment: 1 } }, select: { failedLogins: true, status: true } });
  if (p.status === "ACTIVE" && p.failedLogins >= MAX_FAILED_LOGINS) {
    await autoBlock(partnerId, `${MAX_FAILED_LOGINS} intentos de acceso fallidos`, { ip: ctx.ip ?? null });
    return true;
  }
  return p.status !== "ACTIVE";
}

/**
 * Valida correo + contraseña. Devuelve el id del socio o lanza AppError con mensaje genérico.
 * Fallos: se registran (LOGIN_FAIL); al 5.º la cuenta pasa a BLOCKED. El correo desconocido también se limita (plogin).
 */
export async function verifyPartnerPassword(emailRaw: string, password: string, ctx: Ctx = {}): Promise<{ id: string }> {
  const email = emailRaw.trim().toLowerCase();
  const rlKey = `plogin:${email}`;
  const generic = new AppError("Correo o contraseña inválidos.");
  if (await isLimited(rlKey, MAX_FAILED_LOGINS)) throw new AppError("Demasiados intentos. Espera 15 minutos.");

  const p = await db.partner.findUnique({ where: { email }, select: { id: true, passwordHash: true, status: true } });
  const ok = await bcrypt.compare(password, p?.passwordHash ?? (await getDummyHash()));
  if (!p || !ok) {
    await hit(rlKey, LOGIN_WINDOW_MS);
    if (p) {
      await logPartnerActivity({ partnerId: p.id, type: "LOGIN_FAIL", meta: { reason: "password" }, ...ctx });
      if (p.status === "ACTIVE" && (await registerFailure(p.id, ctx))) {
        throw new AppError("Tu cuenta fue bloqueada por intentos fallidos. Contacta a MAC Compresores.", "FORBIDDEN");
      }
    }
    throw generic;
  }
  if (p.status !== "ACTIVE") {
    await logPartnerActivity({ partnerId: p.id, type: "LOGIN_FAIL", meta: { reason: "blocked" }, ...ctx });
    throw new AppError("Tu cuenta está bloqueada. Contacta a MAC Compresores.", "FORBIDDEN");
  }
  await clear(rlKey);
  await logPartnerActivity({ partnerId: p.id, type: "LOGIN_OK", ...ctx });
  return { id: p.id };
}

// ---- TOTP ----
/** Nuevo secreto base32 y URI otpauth (issuer «MAC Compresores», label = correo). */
export function newTotpSecret(email: string) {
  const secret = generateSecret();
  return { secret, uri: generateURI({ issuer: TOTP_ISSUER, label: email, secret }) };
}

/**
 * Verifica un código TOTP de 6 dígitos con ventana ±1 (30 s) y anti-reuso: el paso aceptado debe ser mayor
 * que `totpLastStep`, y se guarda de forma atómica (dos peticiones con el mismo código no pasan las dos).
 * `now` solo para pruebas (epoch en segundos).
 */
export async function verifyTotp(partner: { id: string; totpSecretEnc: string | null; totpLastStep: number | null }, code: string, now = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!partner.totpSecretEnc || !/^\d{6}$/.test(code)) return false;
  const secret = decryptSecret(partner.totpSecretEnc);
  const current = Math.floor(now / 30);
  const r = verifySync({
    secret, token: code, epoch: now, epochTolerance: 30, guardrails: GUARDRAILS,
    // El tope evita que un totpLastStep futuro (reloj adelantado) provoque una excepción de la librería.
    afterTimeStep: partner.totpLastStep === null ? undefined : Math.min(partner.totpLastStep, current + 1),
  });
  if (!r.valid) return false;
  if (!("epoch" in r)) return false; // resultado HOTP: no aplica
  const step = Math.floor(r.epoch / 30);
  const claimed = await db.partner.updateMany({
    where: { id: partner.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
    data: { totpLastStep: step },
  });
  return claimed.count === 1;
}

// ---- Códigos de respaldo ----
const BACKUP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const normBackup = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** 10 códigos `xxxxx-xxxxx` en claro (se muestran una sola vez) y sus hashes bcrypt para guardar. */
export async function generateBackupCodes(): Promise<{ plain: string[]; hashes: string[] }> {
  const plain = Array.from({ length: BACKUP_CODE_COUNT }, () => {
    const c = Array.from({ length: 10 }, () => BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)]).join("");
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
  const hashes = await Promise.all(plain.map((c) => bcrypt.hash(normBackup(c), BACKUP_COST)));
  return { plain, hashes };
}

/** Consume un código de respaldo (un solo uso, atómico). true si era válido. */
export async function consumeBackupCode(partner: { id: string; backupCodes: string[] }, code: string): Promise<boolean> {
  const n = normBackup(code);
  if (n.length !== 10) return false;
  for (const hash of partner.backupCodes) {
    if (!(await bcrypt.compare(n, hash))) continue;
    // Atómico: si otra petición ya lo consumió, `has` ya no coincide y count = 0.
    const fresh = await db.partner.findUnique({ where: { id: partner.id }, select: { backupCodes: true } });
    const res = await db.partner.updateMany({
      where: { id: partner.id, backupCodes: { has: hash } },
      data: { backupCodes: (fresh?.backupCodes ?? []).filter((h) => h !== hash) },
    });
    return res.count === 1;
  }
  return false;
}
