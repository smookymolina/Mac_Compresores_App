import "server-only";
import { createHash, createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { renderEmail } from "@/lib/email-layout";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { hit } from "@/lib/rate-limit";
import { logPartnerActivity } from "./activity";
import { registerFailure } from "./auth";
import { PARTNER_COOKIE, PARTNER_COOKIE_PATH, PARTNER_COOKIE_SECURE } from "./cookie";

/** Segundo factor por correo: código de 6 dígitos; el dispositivo queda de confianza 30 días. */
export const EMAIL_CODE_TTL_MS = 10 * 60_000;
const MAX_CODE_TRIES = 5;
const MAX_SENDS = 3; // por ventana de 10 min
const TRUST_MS = 30 * 24 * 3_600_000;
const DEVICE_COOKIE = `${PARTNER_COOKIE}_dev`;

type Ctx = { ip?: string | null; userAgent?: string | null };

const codeHash = (partnerId: string, code: string) => createHash("sha256").update(`${partnerId}:${code}`).digest("hex");

function deviceKey() {
  const s = process.env.PARTNER_TOKEN_SECRET?.trim();
  if (!s || s.length < 16) throw new Error("Falta PARTNER_TOKEN_SECRET (mínimo 16 caracteres).");
  return createHmac("sha256", s).update("mac-partner-device-v1").digest();
}
/** Cambia con la contraseña o el bloqueo: una contraseña nueva invalida todos los dispositivos de confianza. */
const deviceVersion = (p: { passwordHash: string; blockedAt: Date | null }) =>
  createHmac("sha256", deviceKey()).update(`${p.passwordHash}|${p.blockedAt?.getTime() ?? 0}`).digest("base64url").slice(0, 16);

async function sign(partnerId: string) {
  const p = await db.partner.findUniqueOrThrow({ where: { id: partnerId }, select: { passwordHash: true, blockedAt: true } });
  const body = Buffer.from(JSON.stringify({ p: partnerId, exp: Date.now() + TRUST_MS, v: deviceVersion(p) })).toString("base64url");
  return `${body}.${createHmac("sha256", deviceKey()).update(body).digest("base64url")}`;
}

export async function trustDevice(partnerId: string) {
  (await cookies()).set(DEVICE_COOKIE, await sign(partnerId), {
    httpOnly: true, secure: PARTNER_COOKIE_SECURE, sameSite: "strict", path: PARTNER_COOKIE_PATH, expires: new Date(Date.now() + TRUST_MS),
  });
}

/** ¿Este navegador ya verificó un código para este socio en los últimos 30 días? */
export async function isTrustedDevice(partnerId: string): Promise<boolean> {
  const raw = (await cookies()).get(DEVICE_COOKIE)?.value;
  const [body, sig, extra] = raw?.split(".") ?? [];
  if (!body || !sig || extra !== undefined || raw!.length > 512) return false;
  const expected = createHmac("sha256", deviceKey()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
  try {
    const c = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p?: unknown; exp?: unknown; v?: unknown };
    if (c.p !== partnerId || typeof c.exp !== "number" || c.exp < Date.now()) return false;
    const p = await db.partner.findUnique({ where: { id: partnerId }, select: { passwordHash: true, blockedAt: true } });
    return !!p && deviceVersion(p) === c.v;
  } catch {
    return false;
  }
}

/** Genera y envía un código nuevo (invalida el anterior). Máximo 3 envíos cada 10 minutos. */
export async function sendEmailCode(partnerId: string, ctx: Ctx = {}) {
  if ((await hit(`pcodesend:${partnerId}`, EMAIL_CODE_TTL_MS)) > MAX_SENDS) throw new AppError("Ya te enviamos varios códigos. Espera 10 minutos.");
  if (!isMailConfigured()) throw new AppError("No se pudo enviar el código. Contacta a MAC Compresores.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const p = await db.partner.update({
    where: { id: partnerId },
    data: { emailCodeHash: codeHash(partnerId, code), emailCodeExpiresAt: new Date(Date.now() + EMAIL_CODE_TTL_MS), emailCodeTries: 0 },
    select: { name: true, email: true },
  });
  const { html, text } = renderEmail({
    preheader: `Tu código de acceso es ${code}`,
    eyebrow: "Portal de socios",
    title: `Tu código de acceso: ${code}`,
    greeting: `Hola ${p.name}:`,
    paragraphs: ["Escribe este código en el portal de socios para terminar de iniciar sesión."],
    notes: ["Vence en 10 minutos. Si no intentaste entrar, cambia tu contraseña y avisa a MAC Compresores."],
  });
  await sendMail({ to: p.email, subject: `${code} es tu código de acceso a MAC Compresores`, html, text });
  await logPartnerActivity({ partnerId, type: "EMAIL_CODE_SENT", ...ctx });
}

/** Verifica el código. 5 errores invalidan el código y cuentan como fallo de acceso (bloqueo al 5.º). */
export async function verifyEmailCode(partnerId: string, codeRaw: string, ctx: Ctx = {}) {
  const code = codeRaw.replace(/\D/g, "");
  const p = await db.partner.findUnique({ where: { id: partnerId }, select: { emailCodeHash: true, emailCodeExpiresAt: true, emailCodeTries: true } });
  if (!p?.emailCodeHash || !p.emailCodeExpiresAt || p.emailCodeExpiresAt < new Date()) {
    throw new AppError("El código venció. Pide uno nuevo.");
  }
  const ok = code.length === 6 && timingSafeEqual(Buffer.from(codeHash(partnerId, code)), Buffer.from(p.emailCodeHash));
  if (!ok) {
    const tries = p.emailCodeTries + 1;
    await db.partner.update({ where: { id: partnerId }, data: tries >= MAX_CODE_TRIES ? { emailCodeHash: null, emailCodeExpiresAt: null, emailCodeTries: 0 } : { emailCodeTries: tries } });
    await logPartnerActivity({ partnerId, type: "EMAIL_CODE_FAIL", ...ctx });
    if (await registerFailure(partnerId, ctx)) throw new AppError("Tu cuenta fue bloqueada por intentos fallidos. Contacta a MAC Compresores.", "FORBIDDEN");
    throw new AppError(tries >= MAX_CODE_TRIES ? "Demasiados códigos incorrectos. Pide uno nuevo." : "El código no es correcto.");
  }
  await db.partner.update({ where: { id: partnerId }, data: { emailCodeHash: null, emailCodeExpiresAt: null, emailCodeTries: 0, failedLogins: 0 } });
  await logPartnerActivity({ partnerId, type: "EMAIL_CODE_OK", ...ctx });
}
