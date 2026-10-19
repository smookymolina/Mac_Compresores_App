import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

export const MOBILE_APP_KEY = "mobile.app";

export const mobileAppSchema = z.object({
  latest: z.string().default("1.4.0"),
  minimum: z.string().default("1.4.0"),
  /** Ruta de la página de descarga (`/app`), nunca la URL directa del archivo. */
  androidUrl: z.string().nullable().default(null),
  iosUrl: z.string().nullable().default(null),
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
