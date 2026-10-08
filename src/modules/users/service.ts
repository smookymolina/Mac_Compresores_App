import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth/session";

// Hash real para comparar cuando el usuario no existe (tiempo constante).
const DUMMY_HASH = bcrypt.hashSync("dummy-password", 12);

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);

export async function verifyCredentials(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  // Compara siempre para no revelar por tiempo si el correo existe.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  return user && user.active && ok ? user : null;
}

export async function listUsers() {
  return db.user.findMany({ include: { role: true }, orderBy: { name: "asc" } });
}

export async function listSellers() {
  return db.user.findMany({ where: { active: true, role: { code: "VENTAS" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export async function createUser(actor: CurrentUser, input: { name: string; email: string; roleId: string; password: string }) {
  const u = await db.user.create({
    data: { name: input.name, email: input.email.toLowerCase(), roleId: input.roleId, passwordHash: await hashPassword(input.password) },
  });
  await audit({ userId: actor.id, action: "user.create", entity: "User", entityId: u.id, data: { roleId: input.roleId } });
  return u;
}

export async function updateUser(
  actor: CurrentUser,
  id: string,
  input: { name: string; roleId: string; active: boolean; password?: string },
) {
  if (id === actor.id && !input.active) throw new AppError("No puedes desactivar tu propia cuenta.");
  await db.$transaction(async (tx) => {
    const prev = await tx.user.findUnique({ where: { id } });
    if (!prev) throw new AppError("Usuario no encontrado.", "NOT_FOUND");
    await tx.user.update({
      where: { id },
      data: {
        name: input.name, roleId: input.roleId, active: input.active,
        ...(input.password ? { passwordHash: await hashPassword(input.password) } : {}),
      },
    });
    // Cambios de rol, estado o contraseña invalidan sesiones abiertas.
    if (prev.roleId !== input.roleId || !input.active || input.password) await tx.session.deleteMany({ where: { userId: id } });
    await audit({ userId: actor.id, action: "user.update", entity: "User", entityId: id,
      data: { roleFrom: prev.roleId, roleTo: input.roleId, active: input.active, passwordReset: !!input.password } }, tx);
  });
}
