import "server-only";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { invitationEmail, passwordChangedEmail } from "./emails";
import { appUrl } from "./tokens";

export const INVITE_TTL_MS = 72 * 60 * 60 * 1000;

/** Aviso «Tu contraseña se cambió», en segundo plano: nunca bloquea ni hace fallar la operación. */
export function notifyPasswordChanged(user: { email: string; name: string }) {
  if (!isMailConfigured() || !process.env.APP_URL?.trim()) return;
  const base = appUrl();
  const mail = passwordChangedEmail({ name: user.name, at: new Date(), loginUrl: `${base}/login`, recoverUrl: `${base}/recuperar` });
  void sendMail({ to: user.email, ...mail })
    .catch((e) => console.error("[mail] contraseña cambiada:", e instanceof Error ? e.message : e));
}

/**
 * Envía la invitación (en primer plano: quien invita necesita saber si salió).
 * Devuelve false si el correo no está configurado o el envío falló; el error solo va al log, sin el enlace.
 */
export async function sendInvitationMail(o: { email: string; name: string; role: string; invitedBy: string; token: string }) {
  if (!isMailConfigured() || !process.env.APP_URL?.trim()) return false;
  const mail = invitationEmail({
    name: o.name, role: o.role, invitedBy: o.invitedBy,
    link: `${appUrl()}/invitacion?token=${o.token}`, hours: INVITE_TTL_MS / 3_600_000,
  });
  try {
    await sendMail({ to: o.email, ...mail });
    return true;
  } catch (e) {
    console.error("[mail] invitación:", e instanceof Error ? e.message : e);
    return false;
  }
}
