import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DOWNLOAD_TTL_MS = 10 * 60_000;

export interface DownloadPayload {
  deviceId: string;
  version: string;
  exp: number;
}

let devSecret: string | null = null;

/** `APP_DOWNLOAD_SECRET` (obligatorio en producción); en desarrollo/pruebas, uno aleatorio por proceso. */
function secret(): string {
  const s = process.env.APP_DOWNLOAD_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") throw new Error("Falta APP_DOWNLOAD_SECRET.");
  if (!devSecret) {
    devSecret = randomBytes(32).toString("hex");
    console.warn("[app-download] APP_DOWNLOAD_SECRET no definido: se usa un secreto aleatorio por proceso (solo desarrollo).");
  }
  return devSecret;
}

const sign = (body: string) => createHmac("sha256", secret()).update(body).digest("base64url");

/** Token = base64url(payload JSON).HMAC-SHA256(base64url). */
export function signDownloadToken(p: { deviceId: string; version: string }, now = Date.now()): { token: string; exp: number } {
  const exp = now + DOWNLOAD_TTL_MS;
  const body = Buffer.from(JSON.stringify({ deviceId: p.deviceId, version: p.version, exp })).toString("base64url");
  return { token: `${body}.${sign(body)}`, exp };
}

/** Payload si la firma es válida (comparación de tiempo constante) y no ha vencido; si no, null. */
export function verifyDownloadToken(token: string, now = Date.now()): DownloadPayload | null {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<DownloadPayload>;
    if (typeof p.deviceId !== "string" || typeof p.version !== "string" || typeof p.exp !== "number") return null;
    return p.exp > now ? (p as DownloadPayload) : null;
  } catch {
    return null;
  }
}
