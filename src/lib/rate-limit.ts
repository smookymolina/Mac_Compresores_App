import "server-only";
import { db } from "@/lib/db";

/**
 * Límite de intentos por clave en la BD: sobrevive reinicios y se comparte entre instancias.
 * `hit` incrementa de forma atómica (un solo UPSERT) y devuelve el conteo dentro de la ventana vigente.
 */
export async function hit(key: string, windowMs: number): Promise<number> {
  const resetAt = new Date(Date.now() + windowMs);
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" < NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < NOW() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count"`;
  return row!.count;
}

/** ¿La clave ya alcanzó `max` intentos en su ventana vigente? (no incrementa). */
export async function isLimited(key: string, max: number): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  return !!row && row.resetAt > new Date() && row.count >= max;
}

export async function clear(key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** Limpieza (trabajo diario): borra ventanas vencidas. */
export async function purgeExpired() {
  return (await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } })).count;
}
