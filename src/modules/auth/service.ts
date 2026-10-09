import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { hashPassword } from "@/modules/users/service";

export const RESET_TTL_MS = 30 * 60 * 1000;
const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** URL pública de la app. Se toma de APP_URL (nunca del Host de la petición, que el cliente controla). */
function appUrl() {
  const url = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (!url) throw new Error("Falta la variable de entorno APP_URL");
  return url;
}

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

  const token = randomBytes(32).toString("base64url");
  await db.$transaction(async (tx) => {
    // Solo el enlace más reciente es válido.
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
    await tx.passwordResetToken.create({ data: { id: hashToken(token), userId: user.id, expiresAt: new Date(Date.now() + RESET_TTL_MS) } });
    await audit({ userId: user.id, action: "auth.reset_requested", entity: "User", entityId: user.id }, tx);
  });

  const link = `${base}/restablecer?token=${token}`;
  const minutes = RESET_TTL_MS / 60_000;
  // En segundo plano: la respuesta (y su tiempo) es la misma exista o no el correo; los fallos solo van al log.
  void sendMail({
    to: user.email,
    subject: "Restablecer tu contraseña · MAC Compresores",
    text:
      `Hola ${user.name}:\n\nRecibimos una solicitud para restablecer tu contraseña del sistema MAC Compresores.\n` +
      `Abre este enlace para elegir una nueva (vence en ${minutes} minutos y solo funciona una vez):\n\n${link}\n\n` +
      `Si no lo solicitaste, ignora este correo; tu contraseña no cambiará.`,
    html:
      `<p>Hola ${escapeHtml(user.name)}:</p>` +
      `<p>Recibimos una solicitud para restablecer tu contraseña del sistema MAC Compresores.</p>` +
      `<p><a href="${link}">Elegir una nueva contraseña</a></p>` +
      `<p>El enlace vence en ${minutes} minutos y solo funciona una vez. Si no lo solicitaste, ignora este correo; tu contraseña no cambiará.</p>`,
  }).catch((e) => console.error("[mail] restablecer contraseña:", e instanceof Error ? e.message : e));
}

/** ¿El token existe, no se ha usado y no ha vencido? (para mostrar el formulario o un aviso). */
export async function isResetTokenValid(token: string) {
  const t = await db.passwordResetToken.findUnique({ where: { id: hashToken(token) } });
  return !!t && !t.usedAt && t.expiresAt > new Date();
}

/** Consume el token y cambia la contraseña; cierra todas las sesiones abiertas del usuario. */
export async function resetPassword(token: string, newPassword: string) {
  const id = hashToken(token);
  const passwordHash = await hashPassword(newPassword);
  await db.$transaction(async (tx) => {
    const now = new Date();
    // Guarda de estado: solo un uso, y solo si no ha vencido.
    const claimed = await tx.passwordResetToken.updateMany({ where: { id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count !== 1) throw new AppError("El enlace no es válido o ya venció. Solicita uno nuevo.");
    const { userId } = await tx.passwordResetToken.findUniqueOrThrow({ where: { id } });
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.active) throw new AppError("El enlace no es válido o ya venció. Solicita uno nuevo.");
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.session.deleteMany({ where: { userId } });
    await audit({ userId, action: "auth.password_reset", entity: "User", entityId: userId }, tx);
  });
}
