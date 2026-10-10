import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { hashPassword } from "@/modules/users/service";
import { passwordResetEmail } from "./emails";
import { notifyPasswordChanged } from "./notify";
import { appUrl, claimToken, isTokenValid, issueToken } from "./tokens";

export const RESET_TTL_MS = 30 * 60 * 1000;

/**
 * Genera un token de un solo uso y lo envía por correo. No revela si el correo existe:
 * si no hay usuario activo con ese correo, no hace nada.
 */
export async function requestPasswordReset(email: string) {
  if (!isMailConfigured() || !process.env.APP_URL?.trim()) {
    throw new AppError("El envío de correos no está configurado. Contacta al administrador.");
  }
  const base = appUrl();
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.active) {
    await audit({ userId: null, action: "auth.reset_requested_unknown", entity: "User", data: { email: email.toLowerCase() } });
    return;
  }

  const token = await db.$transaction(async (tx) => {
    const t = await issueToken(tx, user.id, "RESET", RESET_TTL_MS);
    await audit({ userId: user.id, action: "auth.reset_requested", entity: "User", entityId: user.id }, tx);
    return t;
  });

  const mail = passwordResetEmail({ name: user.name, link: `${base}/restablecer?token=${token}`, minutes: RESET_TTL_MS / 60_000 });
  // En segundo plano: la respuesta (y su tiempo) es la misma exista o no el correo; los fallos solo van al log.
  void sendMail({ to: user.email, ...mail })
    .catch((e) => console.error("[mail] restablecer contraseña:", e instanceof Error ? e.message : e));
}

/** ¿El token existe, no se ha usado y no ha vencido? (para mostrar el formulario o un aviso). */
export const isResetTokenValid = (token: string) => isTokenValid(db, token, "RESET");

/** ¿La invitación sigue vigente? */
export const isInvitationValid = (token: string) => isTokenValid(db, token, "INVITE");

const invalidReset = () => new AppError("El enlace no es válido o ya venció. Solicita uno nuevo.");
const invalidInvite = () => new AppError("La invitación no es válida o ya venció. Pide al administrador que te la reenvíe.");

/** Consume el token y cambia la contraseña; cierra todas las sesiones abiertas del usuario. */
export async function resetPassword(token: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  const user = await db.$transaction(async (tx) => {
    const userId = await claimToken(tx, token, "RESET", invalidReset);
    const u = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!u.active) throw invalidReset();
    // Restablecer también activa una invitación pendiente (ya demostró que controla el correo).
    await tx.user.update({ where: { id: userId }, data: { passwordHash, invitePending: false } });
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await tx.session.deleteMany({ where: { userId } });
    await audit({ userId, action: "auth.password_reset", entity: "User", entityId: userId }, tx);
    return u;
  });
  notifyPasswordChanged(user);
}

/** Activa la cuenta invitada con la contraseña elegida. Devuelve el id del usuario (para abrir su sesión). */
export async function acceptInvitation(token: string, newPassword: string) {
  const passwordHash = await hashPassword(newPassword);
  return db.$transaction(async (tx) => {
    const userId = await claimToken(tx, token, "INVITE", invalidInvite);
    // Guarda de estado: solo una activación y solo para cuentas activas con invitación pendiente.
    const done = await tx.user.updateMany({ where: { id: userId, active: true, invitePending: true }, data: { passwordHash, invitePending: false } });
    if (done.count !== 1) throw invalidInvite();
    await tx.passwordResetToken.deleteMany({ where: { userId, usedAt: null } });
    await tx.session.deleteMany({ where: { userId } });
    await audit({ userId, action: "auth.invitation_accepted", entity: "User", entityId: userId }, tx);
    return userId;
  });
}
