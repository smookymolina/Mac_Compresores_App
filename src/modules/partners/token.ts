import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Vigencia de la URL firmada del PNG de un precio. */
export const PRICE_TOKEN_TTL_SECONDS = 60;

export type PriceTokenClaims = { productId: string; partnerId: string; sessionId: string };

function secret(): string {
  const s = process.env.PARTNER_TOKEN_SECRET;
  if (!s || s.length < 16) throw new Error("PARTNER_TOKEN_SECRET no está configurado (mínimo 16 caracteres)");
  return s;
}

function mac(body: string): Buffer {
  return createHmac("sha256", secret()).update(body).digest();
}

/**
 * Token `base64url(payload).base64url(hmac)`. No lleva el precio: solo identifica producto, socio y sesión.
 * `exp` (segundos unix) es opcional y existe para pruebas; por defecto vence en 60 s.
 */
export function signPriceToken(c: PriceTokenClaims & { exp?: number }): string {
  const exp = c.exp ?? Math.floor(Date.now() / 1000) + PRICE_TOKEN_TTL_SECONDS;
  const body = Buffer.from(JSON.stringify({ p: c.productId, u: c.partnerId, s: c.sessionId, e: exp })).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

/** Devuelve los datos si la firma es válida y no venció; null en cualquier otro caso (sin detalle). */
export function verifyPriceToken(t: string): PriceTokenClaims | null {
  try {
    if (typeof t !== "string" || t.length > 600) return null;
    const parts = t.split(".");
    if (parts.length !== 2) return null;
    const [body, sig] = parts as [string, string];
    const given = Buffer.from(sig, "base64url");
    const expected = mac(body);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
    const d = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { p?: unknown; u?: unknown; s?: unknown; e?: unknown };
    if (typeof d.p !== "string" || typeof d.u !== "string" || typeof d.s !== "string" || typeof d.e !== "number") return null;
    if (d.e < Math.floor(Date.now() / 1000)) return null;
    return { productId: d.p, partnerId: d.u, sessionId: d.s };
  } catch {
    return null;
  }
}
