import "server-only";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { hit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { loadCurrentUser } from "./device";
import { jsonResponse } from "./http";
import { signDownloadToken, verifyDownloadToken, type DownloadPlatform } from "./download-token";
import { IOS_BUNDLE_ID } from "./version";
import { currentAndroidApk, currentIosIpa, releaseFile, type ReleaseFile } from "./releases";

export const DOWNLOAD_PATH = "/api/app/download/android";
export const IOS_MANIFEST_PATH = "/api/app/download/ios/manifest.plist";
export const IOS_IPA_PATH = "/api/app/download/ios/app.ipa";
export const IOS_APP_TITLE = "MAC Campo";
const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60_000;
const NO_RELEASE = "Aún no hay una versión de la app publicada.";

/** Base absoluta pública (APP_URL; nunca el Host de la petición). En producción debe ser https. */
function publicBase(): string {
  const base = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("Falta la variable de entorno APP_URL");
  if (process.env.NODE_ENV === "production" && !/^https:\/\//i.test(base)) throw new Error("APP_URL debe usar https para instalar en iPhone.");
  return base;
}

const withToken = (p: string, token: string) => `${publicBase()}${p}?t=${encodeURIComponent(token)}`;

/** Enlace `itms-services` que abre el instalador de iOS con el manifiesto firmado por `token`. */
export const iosInstallUrl = (token: string) =>
  `itms-services://?action=download-manifest&url=${encodeURIComponent(withToken(IOS_MANIFEST_PATH, token))}`;

/** Enlace firmado (10 min) para que el teléfono descargue/instale la versión vigente de su plataforma. */
export async function requestAppDownload(device: Pick<Device, "id">, platform: DownloadPlatform = "android"): Promise<{ url: string; expiresAt: string }> {
  if (platform === "ios") {
    const ipa = await currentIosIpa();
    if (!ipa) throw new AppError(NO_RELEASE, "NOT_FOUND");
    const { token, exp } = signDownloadToken({ deviceId: device.id, version: ipa.version, platform: "ios" });
    return { url: iosInstallUrl(token), expiresAt: new Date(exp).toISOString() };
  }
  const apk = await currentAndroidApk();
  if (!apk) throw new AppError(NO_RELEASE, "NOT_FOUND");
  const { token, exp } = signDownloadToken({ deviceId: device.id, version: apk.version });
  return { url: `${DOWNLOAD_PATH}?t=${encodeURIComponent(token)}`, expiresAt: new Date(exp).toISOString() };
}

/** Enlace de instalación en iPhone para la página /app (usuario con sesión); null si no hay IPA publicado. */
export async function iosWebInstallUrl(userId: string): Promise<string | null> {
  const ipa = await currentIosIpa();
  if (!ipa) return null;
  return iosInstallUrl(signDownloadToken({ userId, version: ipa.version, platform: "ios" }).token);
}

/** ¿El usuario tiene activado el acceso a la app móvil? (para mostrar la página /app). */
export async function userHasMobileAccess(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { active: true, mobileAccess: true } });
  return !!u?.active && u.mobileAccess;
}

type Access = { userId: string; deviceId?: string; version?: string; via: "token" | "session" };

/**
 * Token firmado (de la plataforma) de un dispositivo activo o de un usuario, que sigue activo con acceso móvil;
 * o sesión web con acceso móvil cuando no viene token y `sessionUserId` se proporciona (solo Android).
 */
async function resolveAccess(token: string | null, platform: DownloadPlatform, sessionUserId?: () => Promise<string | null>): Promise<Access> {
  if (token) {
    const p = verifyDownloadToken(token, Date.now(), platform);
    if (!p) throw new AppError("Enlace de descarga inválido o vencido.", "UNAUTHENTICATED");
    let userId = p.userId;
    if (p.deviceId) {
      const device = await db.device.findUnique({ where: { id: p.deviceId }, select: { id: true, userId: true, revokedAt: true } });
      if (!device || device.revokedAt) throw new AppError("Dispositivo revocado o desconocido.", "UNAUTHENTICATED");
      userId = device.userId;
    }
    if (!userId || !(await loadCurrentUser(userId))) throw new AppError("Tu usuario no tiene acceso a la app móvil.", "FORBIDDEN");
    return { userId, deviceId: p.deviceId, version: p.version, via: "token" };
  }
  const uid = sessionUserId ? await sessionUserId() : null;
  if (!uid) throw new AppError(sessionUserId ? "Inicia sesión para descargar la app." : "Enlace de descarga inválido o vencido.", "UNAUTHENTICATED");
  if (!(await loadCurrentUser(uid))) throw new AppError("Tu usuario no tiene acceso a la app móvil.", "FORBIDDEN");
  return { userId: uid, via: "session" };
}

const STATUS = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400 } as const;

/** Límite por IP + resolución de acceso + mapeo de errores, común a todas las descargas. */
async function guarded(req: Request, platform: DownloadPlatform, sessionUserId: (() => Promise<string | null>) | undefined,
  fn: (access: Access, ip: string) => Promise<Response>): Promise<Response> {
  try {
    const ip = clientIp(req.headers);
    if ((await hit(`app-download:${ip}`, RATE_WINDOW_MS)) > RATE_MAX)
      return jsonResponse({ error: "Demasiadas descargas. Intenta más tarde.", code: "RATE_LIMITED" }, 429);
    return await fn(await resolveAccess(new URL(req.url).searchParams.get("t"), platform, sessionUserId), ip);
  } catch (e) {
    if (e instanceof AppError) return jsonResponse({ error: e.message, code: e.code }, STATUS[e.code] ?? 400);
    console.error("[app-download]", e instanceof Error ? e.message : "error desconocido");
    return jsonResponse({ error: "Ocurrió un error inesperado.", code: "INTERNAL" }, 500);
  }
}

/** La versión del token si sigue en disco; si no, la vigente. */
async function resolveFile(access: Access, platform: DownloadPlatform): Promise<ReleaseFile> {
  const file = (access.version ? await releaseFile(access.version, platform) : null)
    ?? (platform === "ios" ? await currentIosIpa() : await currentAndroidApk());
  if (!file) throw new AppError(NO_RELEASE, "NOT_FOUND");
  return file;
}

async function streamFile(access: Access, ip: string, platform: DownloadPlatform, file: ReleaseFile, contentType: string) {
  await audit({ userId: access.userId, action: "app.download", entity: "Device", entityId: access.deviceId,
    data: { platform, version: file.version, via: access.via, ip } });
  const body = Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${file.fileName}"`,
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * GET /api/app/download/android: transmite el APK (la versión del token si sigue en disco; si no, la vigente).
 * `sessionUserId` solo se consulta cuando no viene token.
 */
export function androidDownloadResponse(req: Request, sessionUserId: () => Promise<string | null>): Promise<Response> {
  return guarded(req, "android", sessionUserId, async (access, ip) =>
    streamFile(access, ip, "android", await resolveFile(access, "android"), "application/vnd.android.package-archive"));
}

/** GET /api/app/download/ios/app.ipa?t=: solo token de iOS (el instalador no manda cookies). */
export function iosIpaResponse(req: Request): Promise<Response> {
  return guarded(req, "ios", undefined, async (access, ip) =>
    streamFile(access, ip, "ios", await resolveFile(access, "ios"), "application/octet-stream"));
}

const xml = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

/** Manifiesto de instalación Ad Hoc (formato de Apple); todos los valores se escapan para XML. */
export function iosManifestPlist(p: { ipaUrl: string; bundleId: string; version: string; title?: string }): string {
  const s = (v: string) => `<string>${xml(v)}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>items</key>
  <array>
    <dict>
      <key>assets</key>
      <array>
        <dict>
          <key>kind</key>${s("software-package")}
          <key>url</key>${s(p.ipaUrl)}
        </dict>
      </array>
      <key>metadata</key>
      <dict>
        <key>bundle-identifier</key>${s(p.bundleId)}
        <key>bundle-version</key>${s(p.version)}
        <key>kind</key>${s("software")}
        <key>title</key>${s(p.title ?? IOS_APP_TITLE)}
      </dict>
    </dict>
  </array>
</dict>
</plist>
`;
}

/** GET /api/app/download/ios/manifest.plist?t=: manifiesto que apunta al IPA con el mismo token. */
export function iosManifestResponse(req: Request): Promise<Response> {
  return guarded(req, "ios", undefined, async (access) => {
    const file = await resolveFile(access, "ios");
    const ios = await currentIosIpa();
    const token = new URL(req.url).searchParams.get("t")!;
    const body = iosManifestPlist({ ipaUrl: withToken(IOS_IPA_PATH, token), bundleId: ios?.bundleId ?? IOS_BUNDLE_ID, version: file.version });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/xml", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
