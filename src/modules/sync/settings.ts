import "server-only";
import { db } from "@/lib/db";

const KEYS = { priceGraceDays: "sync.priceGraceDays", maxOfflineDays: "sync.maxOfflineDays" } as const;
const DEFAULTS = { priceGraceDays: 3, maxOfflineDays: 7 };

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d);

/** Parámetros de sincronización (Setting); valores por omisión de §5.3. */
export async function syncSettings(): Promise<typeof DEFAULTS> {
  const rows = await db.setting.findMany({ where: { key: { in: Object.values(KEYS) } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  return {
    priceGraceDays: num(get(KEYS.priceGraceDays), DEFAULTS.priceGraceDays),
    maxOfflineDays: num(get(KEYS.maxOfflineDays), DEFAULTS.maxOfflineDays),
  };
}
