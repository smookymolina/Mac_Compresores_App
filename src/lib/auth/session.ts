import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { Permission, RoleCode } from "./permissions";

export const SESSION_COOKIE = "mac_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: RoleCode;
  roleName: string;
  permissions: ReadonlySet<Permission>;
}

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    // COOKIE_SECURE=false solo para acceso HTTP en red local (Docker en LAN); en producción real usar HTTPS.
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === "true" : process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { id: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { id: hashToken(token) },
    include: { user: { include: { role: { include: { permissions: { include: { permission: true } } } } } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.active) return null;
  const u = session.user;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role.code as RoleCode,
    roleName: u.role.name,
    permissions: new Set(u.role.permissions.map((rp) => rp.permission.code as Permission)),
  };
});

/** Para páginas: redirige a /login si no hay sesión. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export function can(user: CurrentUser, p: Permission) {
  return user.permissions.has(p);
}

export function assertCan(user: CurrentUser, ...anyOf: Permission[]) {
  if (!anyOf.some((p) => user.permissions.has(p))) throw new AppError("No tienes permiso para esta operación.", "FORBIDDEN");
}

/** Para server actions y route handlers: lanza en vez de redirigir. */
export async function requirePermission(...anyOf: Permission[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Sesión expirada. Inicia sesión de nuevo.", "UNAUTHENTICATED");
  assertCan(user, ...anyOf);
  return user;
}

/** Para páginas: muestra 404/redirect si no tiene permiso. */
export async function requirePagePermission(...anyOf: Permission[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!anyOf.some((p) => user.permissions.has(p))) redirect("/dashboard?denied=1");
  return user;
}
