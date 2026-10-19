import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const DOWNLOAD_TTL_MS = 10 * 60_000;

export type DownloadPlatform = "android" | "ios";

/** Sujeto: un dispositivo (pedido desde la app) o un usuario (página /app con sesión; solo iOS, el instalador no manda cookies). */
export interface DownloadPayload {
  deviceId?: string;
  userId?: string;
  version: string;
  platform: DownloadPlatform;
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
export function signDownloadToken(
  p: { deviceId?: string; userId?: string; version: string; platform?: DownloadPlatform },
  now = Date.now(),
): { token: string; exp: number } {
  if (!p.deviceId === !p.userId) throw new Error("El token de descarga requiere deviceId o userId.");
  const exp = now + DOWNLOAD_TTL_MS;
  const payload = { deviceId: p.deviceId, userId: p.userId, version: p.version, platform: p.platform ?? "android", exp };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${body}.${sign(body)}`, exp };
}

/**
 * Payload si la firma es válida (comparación de tiempo constante), no ha vencido y es de la plataforma esperada
 * (un token de iOS no sirve para Android ni al revés); si no, null.
 */
export function verifyDownloadToken(token: string, now = Date.now(), platform: DownloadPlatform = "android"): DownloadPayload | null {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<DownloadPayload>;
    const subject = typeof p.deviceId === "string" ? !p.userId : typeof p.userId === "string";
    if (!subject || typeof p.version !== "string" || typeof p.exp !== "number") return null;
    if ((p.platform ?? "android") !== platform) return null;
    return p.exp > now ? ({ ...p, platform } as DownloadPayload) : null;
  } catch {
    return null;
  }
}
