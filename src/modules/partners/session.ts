import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hashToken } from "@/lib/auth/session";
import { hit, isLimited } from "@/lib/rate-limit";
import { logPartnerActivity } from "./activity";
import { PARTNER_COOKIE, PARTNER_COOKIE_PATH, PARTNER_COOKIE_SECURE, PARTNER_PRE_COOKIE } from "./cookie";

export { PARTNER_COOKIE, PARTNER_PRE_COOKIE } from "./cookie";

export const PARTNER_IDLE_MS = 30 * 60_000;
export const PARTNER_ABSOLUTE_MS = 8 * 60 * 60_000;
export const PARTNER_PRE_TTL_MS = 10 * 60_000;
const TOUCH_EVERY_MS = 60_000;
const SEEN_EVERY_MS = 5 * 60_000;

/** Datos del socio que viajan por la sesión: sin hash de contraseña, secreto TOTP ni códigos de respaldo. */
export const sessionPartnerSelect = {
  id: true, email: true, name: true, company: true,
  discountPct: true, dailyQuota: true, status: true, totpEnabledAt: true,
} satisfies Prisma.PartnerSelect;
export type SessionPartner = Prisma.PartnerGetPayload<{ select: typeof sessionPartnerSelect }>;

const cookieOpts = (expires: Date) => ({
  httpOnly: true, secure: PARTNER_COOKIE_SECURE, sameSite: "strict" as const, path: PARTNER_COOKIE_PATH, expires,
});

// ---- Cookie previa (contraseña correcta, falta el segundo factor) ----
function preKey() {
  const s = process.env.PARTNER_TOKEN_SECRET?.trim();
  if (!s || s.length < 16) throw new Error("Falta PARTNER_TOKEN_SECRET (mínimo 16 caracteres).");
  return createHmac("sha256", s).update("mac-partner-pre-v1").digest();
}

/**
 * Huella del estado del socio que ata la cookie previa: cambia con la contraseña, el reset de 2FA y el bloqueo/desbloqueo,
 * así una copia de la cookie deja de servir en cuanto cambia cualquiera de ellos.
 */
const preVersion = (p: { passwordHash: string; totpEnabledAt: Date | null; blockedAt: Date | null; status: string }) =>
  createHmac("sha256", preKey()).update(`${p.passwordHash}|${p.totpEnabledAt?.getTime() ?? 0}|${p.blockedAt?.getTime() ?? 0}|${p.status}`).digest("base64url").slice(0, 16);
const preUsedKey = (token: string) => `ppreused:${token.slice(token.lastIndexOf(".") + 1)}`;

/** Token `base64url(JSON{p,exp,v}).base64url(HMAC)`. Puro respecto a la fecha para poder probarlo. */
export function signPreToken(partnerId: string, now = Date.now(), v = ""): string {
  const body = Buffer.from(JSON.stringify({ p: partnerId, exp: now + PARTNER_PRE_TTL_MS, v })).toString("base64url");
  return `${body}.${createHmac("sha256", preKey()).update(body).digest("base64url")}`;
}

export function verifyPreToken(token: string, now = Date.now()): string | null {
  return readPreToken(token, now)?.p ?? null;
}

function readPreToken(token: string, now = Date.now()): { p: string; v: string } | null {
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined || token.length > 512) return null;
  const expected = createHmac("sha256", preKey()).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p?: unknown; exp?: unknown; v?: unknown };
    return typeof p.p === "string" && typeof p.exp === "number" && p.exp > now ? { p: p.p, v: typeof p.v === "string" ? p.v : "" } : null;
  } catch {
    return null;
  }
}

const preStateSelect = { passwordHash: true, totpEnabledAt: true, blockedAt: true, status: true } satisfies Prisma.PartnerSelect;

export async function setPendingPartner(partnerId: string) {
  const st = await db.partner.findUniqueOrThrow({ where: { id: partnerId }, select: preStateSelect });
  (await cookies()).set(PARTNER_PRE_COOKIE, signPreToken(partnerId, Date.now(), preVersion(st)), cookieOpts(new Date(Date.now() + PARTNER_PRE_TTL_MS)));
}

/** Borra la cookie previa y la marca como usada en BD: una copia del valor ya no sirve para más intentos. */
export async function clearPendingPartner() {
  const jar = await cookies();
  const raw = jar.get(PARTNER_PRE_COOKIE)?.value;
  if (raw && readPreToken(raw)) await hit(preUsedKey(raw), PARTNER_PRE_TTL_MS);
  jar.delete({ name: PARTNER_PRE_COOKIE, path: PARTNER_COOKIE_PATH });
}

/** Socio que ya puso su contraseña y está en el paso de 2FA (para /2fa). null si no hay cookie válida o está bloqueado. */
export async function getPendingPartner() {
  const raw = (await cookies()).get(PARTNER_PRE_COOKIE)?.value;
  const claims = raw ? readPreToken(raw) : null;
  if (!raw || !claims) return null;
  if (await isLimited(preUsedKey(raw), 1)) return null;
  const p = await db.partner.findUnique({ where: { id: claims.p }, select: { ...sessionPartnerSelect, ...preStateSelect } });
  if (!p || p.status !== "ACTIVE" || preVersion(p) !== claims.v) return null;
  const { passwordHash: _h, blockedAt: _b, ...partner } = p;
  return partner;
}

// ---- Sesión ----
/** Crea la sesión (una sola activa por socio: borra las anteriores) y fija la cookie. */
export async function createPartnerSession(partnerId: string, ctx: { ip?: string | null; userAgent?: string | null } = {}) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const expiresAt = new Date(now + PARTNER_ABSOLUTE_MS);
  const [revoked] = await db.$transaction([
    db.partnerSession.deleteMany({ where: { partnerId } }),
    db.partnerSession.create({
      data: { id: hashToken(token), partnerId, ip: ctx.ip?.slice(0, 64), userAgent: ctx.userAgent?.slice(0, 300), expiresAt },
    }),
  ]);
  if (revoked.count > 0) await logPartnerActivity({ partnerId, type: "SESSION_REVOKED", meta: { reason: "new_login", count: revoked.count }, ip: ctx.ip, userAgent: ctx.userAgent });
  (await cookies()).set(PARTNER_COOKIE, token, cookieOpts(expiresAt));
}

export async function destroyPartnerSession() {
  const jar = await cookies();
  const token = jar.get(PARTNER_COOKIE)?.value;
  if (token) await db.partnerSession.deleteMany({ where: { id: hashToken(token) } });
  jar.delete({ name: PARTNER_COOKIE, path: PARTNER_COOKIE_PATH });
}

/**
 * Sesión vigente: 30 min de inactividad y 8 h absolutas. Actualiza lastActivityAt/lastSeenAt con escritura limitada.
 * Devuelve null si no hay cookie, venció, o el socio está bloqueado.
 */
export async function getCurrentPartner(): Promise<{ partner: SessionPartner; sessionId: string } | null> {
  const token = (await cookies()).get(PARTNER_COOKIE)?.value;
  if (!token || token.length > 200) return null;
  const sessionId = hashToken(token);
  const s = await db.partnerSession.findUnique({ where: { id: sessionId }, include: { partner: { select: { ...sessionPartnerSelect, lastSeenAt: true } } } });
  if (!s) return null;
  const now = Date.now();
  if (s.expiresAt.getTime() <= now || now - s.lastActivityAt.getTime() > PARTNER_IDLE_MS) {
    await db.partnerSession.deleteMany({ where: { id: sessionId } });
    return null;
  }
  const { lastSeenAt, ...partner } = s.partner;
  if (partner.status !== "ACTIVE") return null;
  if (now - s.lastActivityAt.getTime() > TOUCH_EVERY_MS)
    await db.partnerSession.update({ where: { id: sessionId }, data: { lastActivityAt: new Date(now) } }).catch(() => {});
  if (!lastSeenAt || now - lastSeenAt.getTime() > SEEN_EVERY_MS)
    await db.partner.update({ where: { id: partner.id }, data: { lastSeenAt: new Date(now) } }).catch(() => {});
  return { partner, sessionId };
}

/** Para páginas: redirige a /login si no hay sesión. */
export async function requirePartner() {
  const cur = await getCurrentPartner();
  if (!cur) redirect("/socios/login");
  return cur;
}

/** Para server actions y route handlers: lanza en vez de redirigir. */
export async function requirePartnerAction() {
  const cur = await getCurrentPartner();
  if (!cur) throw new AppError("Tu sesión expiró. Inicia sesión de nuevo.", "UNAUTHENTICATED");
  return cur;
}
