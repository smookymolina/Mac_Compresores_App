import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";

const schema = z.object({
  latest: z.string().default("1.4.0"),
  minimum: z.string().default("1.4.0"),
  androidUrl: z.string().nullable().default(null),
  iosUrl: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type MobileAppVersion = z.infer<typeof schema>;

/** Setting `mobile.app` con valores por omisión. */
export async function mobileAppVersion(): Promise<MobileAppVersion> {
  const s = await db.setting.findUnique({ where: { key: "mobile.app" } });
  const parsed = schema.safeParse(s?.value ?? {});
  return parsed.success ? parsed.data : schema.parse({});
}
