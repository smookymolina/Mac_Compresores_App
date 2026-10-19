import "server-only";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { hit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { loadCurrentUser } from "./device";
import { jsonResponse } from "./http";
import { signDownloadToken, verifyDownloadToken } from "./download-token";
import { apkName, apkPath, currentAndroidApk } from "./releases";

export const DOWNLOAD_PATH = "/api/app/download/android";
const RATE_MAX = 30;
const RATE_WINDOW_MS = 10 * 60_000;

/** Enlace firmado (10 min) para que el teléfono descargue el APK vigente. */
export async function requestAppDownload(device: Pick<Device, "id">): Promise<{ url: string; expiresAt: string }> {
  const apk = await currentAndroidApk();
  if (!apk) throw new AppError("Aún no hay una versión de la app publicada.", "NOT_FOUND");
  const { token, exp } = signDownloadToken({ deviceId: device.id, version: apk.version });
  return { url: `${DOWNLOAD_PATH}?t=${encodeURIComponent(token)}`, expiresAt: new Date(exp).toISOString() };
}

/** ¿El usuario tiene activado el acceso a la app móvil? (para mostrar la página /app). */
export async function userHasMobileAccess(userId: string): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { active: true, mobileAccess: true } });
  return !!u?.active && u.mobileAccess;
}

type Access = { userId: string; deviceId?: string; version?: string; via: "token" | "session" };

/** Token firmado de un dispositivo activo cuyo usuario sigue activo con acceso móvil, o sesión web con acceso móvil. */
async function resolveAccess(token: string | null, sessionUserId: () => Promise<string | null>): Promise<Access> {
  if (token) {
    const p = verifyDownloadToken(token);
    if (!p) throw new AppError("Enlace de descarga inválido o vencido.", "UNAUTHENTICATED");
    const device = await db.device.findUnique({ where: { id: p.deviceId }, select: { id: true, userId: true, revokedAt: true } });
    if (!device || device.revokedAt) throw new AppError("Dispositivo revocado o desconocido.", "UNAUTHENTICATED");
    if (!(await loadCurrentUser(device.userId))) throw new AppError("Tu usuario no tiene acceso a la app móvil.", "FORBIDDEN");
    return { userId: device.userId, deviceId: device.id, version: p.version, via: "token" };
  }
  const uid = await sessionUserId();
  if (!uid) throw new AppError("Inicia sesión para descargar la app.", "UNAUTHENTICATED");
  if (!(await loadCurrentUser(uid))) throw new AppError("Tu usuario no tiene acceso a la app móvil.", "FORBIDDEN");
  return { userId: uid, via: "session" };
}

const STATUS = { UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400 } as const;

/**
 * GET /api/app/download/android: transmite el APK (la versión del token si sigue en disco; si no, la vigente).
 * `sessionUserId` solo se consulta cuando no viene token.
 */
export async function androidDownloadResponse(req: Request, sessionUserId: () => Promise<string | null>): Promise<Response> {
  try {
    const ip = clientIp(req.headers);
    if ((await hit(`app-download:${ip}`, RATE_WINDOW_MS)) > RATE_MAX)
      return jsonResponse({ error: "Demasiadas descargas. Intenta más tarde.", code: "RATE_LIMITED" }, 429);
    const access = await resolveAccess(new URL(req.url).searchParams.get("t"), sessionUserId);

    let file: { version: string; path: string; size: number; fileName: string } | null = null;
    if (access.version) {
      const p = apkPath(access.version);
      const st = await stat(p).catch(() => null);
      if (st?.isFile()) file = { version: access.version, path: p, size: st.size, fileName: apkName(access.version) };
    }
    file ??= await currentAndroidApk();
    if (!file) throw new AppError("Aún no hay una versión de la app publicada.", "NOT_FOUND");

    await audit({ userId: access.userId, action: "app.download", entity: "Device", entityId: access.deviceId,
      data: { version: file.version, via: access.via, ip } });
    const body = Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>;
    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.android.package-archive",
        "Content-Disposition": `attachment; filename="${file.fileName}"`,
        "Content-Length": String(file.size),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return jsonResponse({ error: e.message, code: e.code }, STATUS[e.code] ?? 400);
    console.error("[app-download]", e instanceof Error ? e.message : "error desconocido");
    return jsonResponse({ error: "Ocurrió un error inesperado.", code: "INTERNAL" }, 500);
  }
}
