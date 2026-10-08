import "server-only";
import { headers } from "next/headers";
import { db } from "@/lib/db";

const WINDOW_MS = 15 * 60_000;

/** Límite por clave: el par correo+IP es estricto; IP y correo solos son más holgados para no bloquear a terceros. */
const LIMITS = { ei: 5, i: 20, e: 30 } as const;

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "desconocida";
}

const keysFor = (email: string, ip: string) => [`ei:${email}|${ip}`, `i:${ip}`, `e:${email}`];
const limitOf = (key: string) => LIMITS[key.slice(0, key.indexOf(":")) as keyof typeof LIMITS];

/** true si alguna de las claves está bloqueada. */
export async function isLoginBlocked(email: string, ip: string) {
  const blocked = await db.loginAttempt.count({
    where: { key: { in: keysFor(email, ip) }, lockedUntil: { gt: new Date() } },
  });
  return blocked > 0;
}

export async function recordLoginFailure(email: string, ip: string) {
  const now = new Date();
  for (const key of keysFor(email, ip)) {
    const prev = await db.loginAttempt.findUnique({ where: { key } });
    const fresh = !prev || now.getTime() - prev.updatedAt.getTime() > WINDOW_MS;
    const count = fresh ? 1 : prev.count + 1;
    const lockedUntil = count >= limitOf(key) ? new Date(now.getTime() + WINDOW_MS) : null;
    await db.loginAttempt.upsert({
      where: { key },
      create: { key, count, lockedUntil },
      update: { count, lockedUntil },
    });
  }
}

/** Un acceso correcto limpia solo el contador del par correo+IP. */
export async function clearLoginFailures(email: string, ip: string) {
  await db.loginAttempt.deleteMany({ where: { key: `ei:${email}|${ip}` } });
}

/** Mantenimiento oportunista: borra contadores caducados. */
export async function purgeLoginAttempts() {
  await db.loginAttempt.deleteMany({ where: { updatedAt: { lt: new Date(Date.now() - WINDOW_MS) } } });
}
