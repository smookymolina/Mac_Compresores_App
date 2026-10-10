import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import type { CurrentUser } from "@/lib/auth/session";
import { hit } from "@/lib/rate-limit";
import { INVITE_TTL_MS, notifyPasswordChanged, sendInvitationMail } from "@/modules/auth/notify";
import { issueToken } from "@/modules/auth/tokens";

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

/** Resultado de una invitación: `mailed=false` si el correo no está configurado o no se pudo enviar. */
export interface InviteResult { userId: string; mailed: boolean }

/**
 * Crea el usuario invitado: contraseña aleatoria inutilizable (nadie la conoce) e invitación pendiente.
 * La persona elige su contraseña con el enlace de un solo uso que recibe por correo (vigencia 72 h).
 * Si el correo falla, el usuario queda creado y se puede reenviar la invitación desde la lista.
 */
export async function createUser(actor: CurrentUser, input: { name: string; email: string; roleId: string }): Promise<InviteResult> {
  const role = await db.role.findUnique({ where: { id: input.roleId } });
  if (!role) throw new AppError("Rol no encontrado.", "NOT_FOUND");
  const email = input.email.toLowerCase();
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) throw new AppError("Ya existe un usuario con ese correo.", "CONFLICT");
  const passwordHash = await hashPassword(randomBytes(32).toString("hex"));
  const { user, token } = await db.$transaction(async (tx) => {
    const user = await tx.user.create({ data: { name: input.name, email, roleId: role.id, passwordHash, invitePending: true } });
    const token = await issueToken(tx, user.id, "INVITE", INVITE_TTL_MS);
    await audit({ userId: actor.id, action: "user.create", entity: "User", entityId: user.id, data: { roleId: role.id, invited: true } }, tx);
    return { user, token };
  });
  const mailed = await sendInvitationMail({ email, name: user.name, role: role.name, invitedBy: actor.name, token });
  if (!mailed) await audit({ userId: actor.id, action: "user.invite_mail_failed", entity: "User", entityId: user.id });
  return { userId: user.id, mailed };
}

/** Reenvía la invitación (nuevo enlace de 72 h; el anterior deja de servir). Solo para invitaciones pendientes. */
export async function resendInvitation(actor: CurrentUser, id: string): Promise<InviteResult> {
  const user = await db.user.findUnique({ where: { id }, include: { role: true } });
  if (!user) throw new AppError("Usuario no encontrado.", "NOT_FOUND");
  if (!user.invitePending) throw new AppError("Este usuario ya activó su cuenta.", "CONFLICT");
  if (!user.active) throw new AppError("El usuario está inactivo. Actívalo antes de reenviar la invitación.");
  // Límite por usuario para no saturar su buzón ni el SMTP.
  if ((await hit(`invite:${id}`, 15 * 60_000)) > 3) throw new AppError("Ya se reenvió varias veces. Espera 15 minutos.");
  const token = await db.$transaction(async (tx) => {
    const t = await issueToken(tx, id, "INVITE", INVITE_TTL_MS);
    await audit({ userId: actor.id, action: "user.invite_resent", entity: "User", entityId: id }, tx);
    return t;
  });
  const mailed = await sendInvitationMail({ email: user.email, name: user.name, role: user.role.name, invitedBy: actor.name, token });
  if (!mailed) await audit({ userId: actor.id, action: "user.invite_mail_failed", entity: "User", entityId: id });
  return { userId: id, mailed };
}

export async function updateUser(
  actor: CurrentUser,
  id: string,
  input: { name: string; roleId: string; active: boolean; password?: string },
) {
  if (id === actor.id && !input.active) throw new AppError("No puedes desactivar tu propia cuenta.");
  const prev = await db.$transaction(async (tx) => {
    const prev = await tx.user.findUnique({ where: { id } });
    if (!prev) throw new AppError("Usuario no encontrado.", "NOT_FOUND");
    await tx.user.update({
      where: { id },
      data: {
        name: input.name, roleId: input.roleId, active: input.active,
        // Si el administrador fija la contraseña, la invitación pendiente deja de aplicar.
        ...(input.password ? { passwordHash: await hashPassword(input.password), invitePending: false } : {}),
      },
    });
    if (input.password) await tx.passwordResetToken.deleteMany({ where: { userId: id, usedAt: null } });
    // Cambios de rol, estado o contraseña invalidan sesiones abiertas.
    if (prev.roleId !== input.roleId || !input.active || input.password) await tx.session.deleteMany({ where: { userId: id } });
    await audit({ userId: actor.id, action: "user.update", entity: "User", entityId: id,
      data: { roleFrom: prev.roleId, roleTo: input.roleId, active: input.active, passwordReset: !!input.password } }, tx);
    return prev;
  });
  if (input.password && !prev.invitePending) notifyPasswordChanged(prev);
}
