import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { compareVersions, isSemver } from "./semver";
import { IOS_BUNDLE_ID, MOBILE_APP_KEY, mobileAppVersion, type MobileAppVersion } from "./version";

export { compareVersions, isSemver } from "./semver";

export type AppPlatform = "android" | "ios";

export const MAX_APK_BYTES = 150 * 1024 * 1024;
export const MAX_IPA_BYTES = 200 * 1024 * 1024;
export const KEEP_RELEASES = 3;
/** Página de descarga (con sesión); el teléfono pide un enlace firmado a /api/sync/app-download. */
export const ANDROID_PAGE = "/app";
export const IOS_PAGE = "/app";

const PLATFORM = {
  android: { ext: "apk", max: MAX_APK_BYTES, label: "APK", maxLabel: "150 MB" },
  ios: { ext: "ipa", max: MAX_IPA_BYTES, label: "IPA", maxLabel: "200 MB" },
} as const;
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export const releasesDir = () => process.env.MOBILE_RELEASES_DIR || path.join(process.cwd(), "releases");
export const releaseName = (version: string, platform: AppPlatform = "android") => `mac-campo-${version}.${PLATFORM[platform].ext}`;
export const apkName = (version: string) => releaseName(version, "android");

/** Ruta del archivo de una versión (la versión se valida: nunca se arma una ruta con texto arbitrario). */
export function releasePath(version: string, platform: AppPlatform = "android") {
  if (!isSemver(version)) throw new AppError("Versión no válida.", "VALIDATION");
  return path.join(releasesDir(), releaseName(version, platform));
}
export const apkPath = (version: string) => releasePath(version, "android");

const semver = z.string().trim().refine(isSemver, "Usa el formato 1.2.3.");
export const releaseInputSchema = z.object({
  version: semver,
  minimum: semver,
  notes: z.string().trim().max(2000).default(""),
  iosUrl: z.string().trim().url("Enlace no válido.").refine((u) => /^https:\/\//i.test(u), "El enlace debe usar https.")
    .optional().or(z.literal("").transform(() => undefined)),
}).refine((v) => compareVersions(v.minimum, v.version) <= 0, { path: ["minimum"], message: "La versión mínima no puede ser mayor que la publicada." });
export type ReleaseInput = z.input<typeof releaseInputSchema>;
export const iosReleaseInputSchema = z.object({ version: semver });

async function toBytes(file: Blob | Uint8Array): Promise<Uint8Array> {
  return file instanceof Uint8Array ? file : new Uint8Array(await file.arrayBuffer());
}

/** Valida (no vacío, tamaño, ZIP) y escribe el archivo de forma atómica (temporal + rename). */
async function storeReleaseFile(platform: AppPlatform, version: string, file: Blob | Uint8Array): Promise<{ sha256: string; size: number }> {
  const { label, max, maxLabel } = PLATFORM[platform];
  const size = file instanceof Uint8Array ? file.byteLength : file.size;
  if (size === 0) throw new AppError(`Selecciona el archivo ${label}.`, "VALIDATION");
  if (size > max) throw new AppError(`El ${label} excede ${maxLabel}.`, "VALIDATION");
  const bytes = await toBytes(file);
  if (!ZIP_MAGIC.every((b, i) => bytes[i] === b)) throw new AppError(`El archivo no es un ${label} válido.`, "VALIDATION");

  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const dir = releasesDir();
  await mkdir(dir, { recursive: true });
  const target = releasePath(version, platform);
  const tmp = path.join(dir, `.upload-${randomBytes(8).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, bytes, { flag: "wx" });
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  return { sha256, size };
}

async function saveSetting(actor: CurrentUser, value: MobileAppVersion, action: string, data: Prisma.InputJsonObject) {
  await db.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: MOBILE_APP_KEY },
      create: { key: MOBILE_APP_KEY, value, updatedById: actor.id },
      update: { value, updatedById: actor.id },
    });
    await audit({ userId: actor.id, action, entity: "Setting", entityId: MOBILE_APP_KEY, data }, tx);
  });
}

/**
 * Publica un APK: valida (ZIP, ≤150 MB, semver, mínima ≤ versión), lo escribe de forma atómica,
 * actualiza `mobile.app`, audita `app.release` y deja solo las últimas 3 versiones.
 */
export async function publishAndroidRelease(actor: CurrentUser, input: ReleaseInput & { file: Blob | Uint8Array }): Promise<MobileAppVersion> {
  assertCan(actor, "users.manage");
  const { file, ...rest } = input;
  const data = releaseInputSchema.parse(rest);
  const { sha256, size } = await storeReleaseFile("android", data.version, file);

  const prev = await mobileAppVersion();
  const value: MobileAppVersion = {
    latest: data.version, minimum: data.minimum, androidUrl: ANDROID_PAGE,
    // Con un IPA Ad Hoc publicado, iOS se instala desde /app; si no, enlace externo opcional (TestFlight).
    iosUrl: prev.ios ? IOS_PAGE : data.iosUrl ?? null, ios: prev.ios,
    notes: data.notes, sha256, size, publishedAt: new Date().toISOString(),
  };
  await saveSetting(actor, value, "app.release", { from: prev.latest, version: data.version, minimum: data.minimum, sha256, size });
  await pruneReleases(data.version);
  return value;
}

/** Publica un IPA Ad Hoc (ZIP, ≤200 MB, semver): `mobile.app.ios`, `iosUrl = /app`, audita `app.release_ios`, conserva 3. */
export async function publishIosRelease(actor: CurrentUser, input: { version: string; file: Blob | Uint8Array }): Promise<MobileAppVersion> {
  assertCan(actor, "users.manage");
  const { version } = iosReleaseInputSchema.parse({ version: input.version });
  const { sha256, size } = await storeReleaseFile("ios", version, input.file);

  const prev = await mobileAppVersion();
  const value: MobileAppVersion = {
    ...prev, iosUrl: IOS_PAGE,
    ios: { latest: version, sha256, size, publishedAt: new Date().toISOString(), bundleId: IOS_BUNDLE_ID },
  };
  await saveSetting(actor, value, "app.release_ios", { from: prev.ios?.latest ?? null, version, sha256, size });
  await pruneReleases(version, "ios");
  return value;
}

/** Borra archivos viejos de la plataforma: conserva las últimas `KEEP_RELEASES` versiones (y siempre `keep`). Devuelve los borrados. */
export async function pruneReleases(keep?: string, platform: AppPlatform = "android"): Promise<string[]> {
  const re = new RegExp(`^mac-campo-(.+)\\.${PLATFORM[platform].ext}$`);
  const names = await readdir(releasesDir()).catch(() => [] as string[]);
  const versions = names.flatMap((n) => {
    const v = re.exec(n)?.[1];
    return v && isSemver(v) ? [v] : [];
  }).sort((a, b) => compareVersions(b, a));
  const doomed = versions.slice(KEEP_RELEASES).filter((v) => v !== keep);
  for (const v of doomed) await unlink(releasePath(v, platform)).catch(() => {});
  return doomed;
}

export interface ReleaseFile { version: string; path: string; size: number; fileName: string }

/** Archivo de una versión concreta si existe en disco. */
export async function releaseFile(version: string, platform: AppPlatform): Promise<ReleaseFile | null> {
  if (!isSemver(version)) return null;
  const p = releasePath(version, platform);
  const st = await stat(p).catch(() => null);
  return st?.isFile() ? { version, path: p, size: st.size, fileName: releaseName(version, platform) } : null;
}

/** APK vigente (según `mobile.app.latest`) si existe en disco. */
export async function currentAndroidApk(): Promise<ReleaseFile | null> {
  const { latest, publishedAt } = await mobileAppVersion();
  return publishedAt ? releaseFile(latest, "android") : null;
}

/** IPA vigente (según `mobile.app.ios.latest`) si existe en disco. */
export async function currentIosIpa(): Promise<(ReleaseFile & { bundleId: string }) | null> {
  const { ios } = await mobileAppVersion();
  const f = ios ? await releaseFile(ios.latest, "ios") : null;
  return f && ios ? { ...f, bundleId: ios.bundleId } : null;
}
