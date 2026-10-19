import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { compareVersions, isSemver } from "./semver";
import { MOBILE_APP_KEY, mobileAppVersion, type MobileAppVersion } from "./version";

export { compareVersions, isSemver } from "./semver";

export const MAX_APK_BYTES = 150 * 1024 * 1024;
export const KEEP_RELEASES = 3;
/** Página de descarga (con sesión); el teléfono pide un enlace firmado a /api/sync/app-download. */
export const ANDROID_PAGE = "/app";

const APK_RE = /^mac-campo-(.+)\.apk$/;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export const releasesDir = () => process.env.MOBILE_RELEASES_DIR || path.join(process.cwd(), "releases");
export const apkName = (version: string) => `mac-campo-${version}.apk`;

/** Ruta del APK de una versión (la versión se valida: nunca se arma una ruta con texto arbitrario). */
export function apkPath(version: string) {
  if (!isSemver(version)) throw new AppError("Versión no válida.", "VALIDATION");
  return path.join(releasesDir(), apkName(version));
}

const semver = z.string().trim().refine(isSemver, "Usa el formato 1.2.3.");
export const releaseInputSchema = z.object({
  version: semver,
  minimum: semver,
  notes: z.string().trim().max(2000).default(""),
  iosUrl: z.string().trim().url("Enlace no válido.").refine((u) => /^https:\/\//i.test(u), "El enlace debe usar https.")
    .optional().or(z.literal("").transform(() => undefined)),
}).refine((v) => compareVersions(v.minimum, v.version) <= 0, { path: ["minimum"], message: "La versión mínima no puede ser mayor que la publicada." });
export type ReleaseInput = z.input<typeof releaseInputSchema>;

async function toBytes(file: Blob | Uint8Array): Promise<Uint8Array> {
  return file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
}

/**
 * Publica un APK: valida (ZIP, ≤150 MB, semver, mínima ≤ versión), lo escribe de forma atómica
 * (temporal + rename), actualiza `mobile.app`, audita `app.release` y deja solo las últimas 3 versiones.
 */
export async function publishAndroidRelease(actor: CurrentUser, input: ReleaseInput & { file: Blob | Uint8Array }): Promise<MobileAppVersion> {
  assertCan(actor, "users.manage");
  const { file, ...rest } = input;
  const data = releaseInputSchema.parse(rest);
  const size = file instanceof Uint8Array ? file.byteLength : file.size;
  if (size === 0) throw new AppError("Selecciona el archivo APK.", "VALIDATION");
  if (size > MAX_APK_BYTES) throw new AppError("El APK excede 150 MB.", "VALIDATION");
  const bytes = await toBytes(file);
  if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) throw new AppError("El archivo no es un APK válido.", "VALIDATION");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = releasesDir();
  await mkdir(dir, { recursive: true });
  const target = apkPath(data.version);
  const tmp = path.join(dir, `.upload-${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, bytes, { flag: "wx" });
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }

  const prev = await mobileAppVersion();
  const value: MobileAppVersion = {
    latest: data.version, minimum: data.minimum, androidUrl: ANDROID_PAGE, iosUrl: data.iosUrl ?? null,
    notes: data.notes, sha256, size, publishedAt: new Date().toISOString(),
  };
  await db.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: MOBILE_APP_KEY },
      create: { key: MOBILE_APP_KEY, value, updatedById: actor.id },
      update: { value, updatedById: actor.id },
    });
    await audit({ userId: actor.id, action: "app.release", entity: "Setting", entityId: MOBILE_APP_KEY,
      data: { from: prev.latest, version: data.version, minimum: data.minimum, sha256, size } }, tx);
  });
  await pruneReleases(data.version);
  return value;
}

/** Borra APKs viejos: conserva las últimas `KEEP_RELEASES` versiones (y siempre `keep`). Devuelve los borrados. */
export async function pruneReleases(keep?: string): Promise<string[]> {
  const names = await readdir(releasesDir()).catch(() => [] as string[]);
  const versions = names.flatMap((n) => {
    const v = APK_RE.exec(n)?.[1];
    return v && isSemver(v) ? [v] : [];
  }).sort((a, b) => compareVersions(b, a));
  const doomed = versions.slice(KEEP_RELEASES).filter((v) => v !== keep);
  for (const v of doomed) await unlink(apkPath(v)).catch(() => {});
  return doomed;
}

/** APK vigente (según `mobile.app.latest`) si existe en disco. */
export async function currentAndroidApk(): Promise<{ version: string; path: string; size: number; fileName: string } | null> {
  const { latest, publishedAt } = await mobileAppVersion();
  if (!publishedAt || !isSemver(latest)) return null;
  const p = apkPath(latest);
  const st = await stat(p).catch(() => null);
  return st?.isFile() ? { version: latest, path: p, size: st.size, fileName: apkName(latest) } : null;
}
