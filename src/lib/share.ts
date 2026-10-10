import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { hit } from "@/lib/rate-limit";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth/session";
import type { Permission, RoleCode } from "@/lib/auth/permissions";

/**
 * Enlaces públicos firmados (HMAC-SHA256) y con vencimiento, para compartir documentos por WhatsApp,
 * donde no se pueden adjuntar archivos desde un enlace. El token lleva el payload completo (sin estado en BD):
 *   base64url(JSON) "." base64url(HMAC(clave, base64url(JSON)))
 * Se guarda el id de quien comparte: al abrir el enlace el documento se genera con SU alcance y permisos
 * vigentes (si se desactiva al usuario o pierde el permiso, el enlace deja de funcionar).
 */

export const QUOTE_SHARE_TTL_MS = 15 * 864e5;
export const REPORT_SHARE_TTL_MS = 7 * 864e5;

export type SharePayload =
  | { t: "quote"; id: string; u: string; exp: number }
  | { t: "report"; k: string; f: string | null; to: string | null; u: string; exp: number };

type Unsigned<P> = P extends unknown ? Omit<P, "exp"> : never;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

/** Clave derivada: separa el uso del secreto (que puede ser el mismo CRON_SECRET) por dominio. */
const deriveKey = (secret: string) => createHmac("sha256", secret).update("mac-share-v1").digest();

/** Firma un payload. Puro (sin entorno) para poder probarlo. */
export function signToken(secret: string, payload: SharePayload): string {
  const body = b64(JSON.stringify(payload));
  return `${body}.${b64(createHmac("sha256", deriveKey(secret)).update(body).digest())}`;
}

/** Valida firma (tiempo constante) y vencimiento. Devuelve null si algo no cuadra. */
export function verifyToken(secret: string, token: string, now = Date.now()): SharePayload | null {
  if (typeof token !== "string" || token.length > 2048) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = createHmac("sha256", deriveKey(secret)).update(body).digest();
  const given = Buffer.from(sig, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SharePayload;
    if (typeof p !== "object" || !p || typeof p.exp !== "number" || typeof p.u !== "string") return null;
    if (p.exp <= now) return null;
    return p;
  } catch {
    return null;
  }
}

/** SHARE_SECRET o, en su defecto, CRON_SECRET. Sin secreto suficientemente largo, la función se deshabilita. */
function shareSecret(): string | null {
  const s = process.env.SHARE_SECRET?.trim() || process.env.CRON_SECRET?.trim() || "";
  return s.length >= 16 ? s : null;
}

function appUrl(): string | null {
  return process.env.APP_URL?.trim().replace(/\/+$/, "") || null;
}

/** null si se puede compartir por enlace; si no, el motivo para mostrar al usuario. */
export function shareUnavailableReason(): string | null {
  if (!shareSecret()) return "Los enlaces para WhatsApp no están configurados (falta SHARE_SECRET). Contacta al administrador.";
  if (!appUrl()) return "Los enlaces para WhatsApp no están configurados (falta APP_URL). Contacta al administrador.";
  return null;
}

/** Crea el enlace público absoluto. `path` sin dominio, p. ej. `/api/compartir/cotizacion/<id>`. */
export function createShareLink(path: string, payload: Unsigned<SharePayload>, ttlMs: number) {
  const secret = shareSecret();
  const base = appUrl();
  if (!secret || !base) throw new AppError(shareUnavailableReason() ?? "Enlaces no configurados.");
  const exp = Date.now() + ttlMs;
  const token = signToken(secret, { ...payload, exp } as SharePayload);
  return { url: `${base}${path}?t=${token}`, expiresAt: new Date(exp).toISOString() };
}

/** Valida el token de una petición pública. */
export function readShareToken(token: string | null): SharePayload | null {
  const secret = shareSecret();
  if (!secret || !token) return null;
  return verifyToken(secret, token);
}

/** Usuario que firmó el enlace, con sus permisos actuales; null si ya no existe o está inactivo. */
export async function loadShareUser(id: string): Promise<CurrentUser | null> {
  const u = await db.user.findUnique({
    where: { id },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  }).catch(() => null);
  if (!u || !u.active) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role.code as RoleCode,
    roleName: u.role.name,
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.code as Permission)),
  };
}


/** Límite por IP para las rutas públicas (generar PDF/CSV es costoso): 60 descargas por 10 minutos. */
export async function shareRateLimited(req: Request): Promise<boolean> {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "desconocida";
  return (await hit(`share:${ip}`, 10 * 60_000)) > 60;
}

/** Respuesta de error de un enlace público: página mínima, sin revelar el motivo exacto. */
export function shareErrorResponse(status: 404 | 429 | 500) {
  const msg =
    status === 404 ? "Este enlace no es válido o ya venció. Pide a tu vendedor que te lo envíe de nuevo."
    : status === 429 ? "Demasiadas descargas. Intenta de nuevo en unos minutos."
    : "No se pudo generar el documento. Intenta más tarde.";
  return new Response(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>MAC Compresores</title></head>` +
      `<body style="margin:0;padding:48px 16px;font:15px/1.6 system-ui,sans-serif;background:#f0f5fa;color:#1e293b;text-align:center;"><p style="margin:0 0 8px;font-weight:600;">MAC Compresores</p><p style="margin:0;">${msg}</p></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
}
