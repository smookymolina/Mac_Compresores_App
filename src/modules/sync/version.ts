import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

export const MOBILE_APP_KEY = "mobile.app";
export const IOS_BUNDLE_ID = "mx.com.maccompresores.campo";

/** Build Ad Hoc de iOS publicado en el hosting (instalación por `itms-services`). */
export const iosReleaseSchema = z.object({
  latest: z.string(),
  sha256: z.string(),
  size: z.number().int().nonnegative(),
  publishedAt: z.string(),
  bundleId: z.string().default(IOS_BUNDLE_ID),
});
export type IosRelease = z.infer<typeof iosReleaseSchema>;

export const mobileAppSchema = z.object({
  latest: z.string().default("1.4.0"),
  minimum: z.string().default("1.4.0"),
  /** Ruta de la página de descarga (`/app`), nunca la URL directa del archivo. */
  androidUrl: z.string().nullable().default(null),
  /** Enlace externo (TestFlight) o `/app` cuando hay un IPA Ad Hoc publicado. */
  iosUrl: z.string().nullable().default(null),
  ios: iosReleaseSchema.nullable().default(null),
  notes: z.string().default(""),
  sha256: z.string().nullable().default(null),
  size: z.number().int().nonnegative().nullable().default(null),
  publishedAt: z.string().nullable().default(null),
});
export type MobileAppVersion = z.infer<typeof mobileAppSchema>;

/** Setting `mobile.app` con valores por omisión. */
export async function mobileAppVersion(): Promise<MobileAppVersion> {
  const s = await db.setting.findUnique({ where: { key: MOBILE_APP_KEY } });
  const parsed = mobileAppSchema.safeParse(s?.value ?? {});
  return parsed.success ? parsed.data : mobileAppSchema.parse({});
}
