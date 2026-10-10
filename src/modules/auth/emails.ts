import "server-only";
import { renderEmail } from "@/lib/email-layout";

/** Correos de acceso (contenido puro, sin envío): restablecer, contraseña cambiada e invitación. */

const SIGNATURE = ["Equipo MAC Compresores"];

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat("es-MX", { dateStyle: "long", timeStyle: "short", timeZone: "America/Mexico_City" }).format(d);

export function passwordResetEmail(o: { name: string; link: string; minutes: number }) {
  return {
    subject: "Restablece tu contraseña · MAC Compresores",
    ...renderEmail({
      preheader: `Elige una nueva contraseña. El enlace vence en ${o.minutes} minutos.`,
      eyebrow: "Seguridad de la cuenta",
      title: "Restablece tu contraseña",
      greeting: `Hola ${o.name}:`,
      paragraphs: [
        "Recibimos una solicitud para restablecer la contraseña de tu cuenta en el sistema MAC Compresores.",
        "Usa el botón para elegir una nueva. Al guardarla se cerrarán las sesiones abiertas de tu cuenta.",
      ],
      cta: { label: "Elegir nueva contraseña", url: o.link },
      notes: [
        `El enlace vence en ${o.minutes} minutos y solo funciona una vez.`,
        "Si no lo solicitaste, ignora este correo: tu contraseña no cambiará.",
      ],
      signature: SIGNATURE,
    }),
  };
}

export function passwordChangedEmail(o: { name: string; at: Date; loginUrl: string; recoverUrl: string }) {
  return {
    subject: "Tu contraseña se cambió · MAC Compresores",
    ...renderEmail({
      preheader: "Se actualizó la contraseña de tu cuenta.",
      eyebrow: "Seguridad de la cuenta",
      title: "Tu contraseña se cambió",
      greeting: `Hola ${o.name}:`,
      paragraphs: [
        `La contraseña de tu cuenta se cambió el ${fmtDate(o.at)} (hora del centro de México). Por seguridad, cerramos las sesiones que tenías abiertas.`,
      ],
      cta: { label: "Iniciar sesión", url: o.loginUrl },
      notes: [
        `Si no fuiste tú, restablece tu contraseña de inmediato en ${o.recoverUrl} y avisa al administrador del sistema.`,
      ],
      signature: SIGNATURE,
    }),
  };
}

export function invitationEmail(o: { name: string; role: string; invitedBy: string; link: string; hours: number }) {
  return {
    subject: "Te invitaron a MAC Compresores",
    ...renderEmail({
      preheader: `${o.invitedBy} te dio acceso al sistema MAC Compresores. Activa tu cuenta.`,
      eyebrow: "Invitación",
      title: "Te invitaron a MAC Compresores",
      greeting: `Hola ${o.name}:`,
      paragraphs: [
        "Se creó tu cuenta en el sistema de cotizaciones, ventas e inventario de MAC Compresores.",
        "Para empezar, activa tu cuenta y elige tu contraseña.",
      ],
      details: [
        { label: "Rol", value: o.role },
        { label: "Invitado por", value: o.invitedBy },
      ],
      cta: { label: "Activar mi cuenta", url: o.link },
      notes: [
        `El enlace vence en ${o.hours} horas y solo funciona una vez. Si vence, pide al administrador que te reenvíe la invitación.`,
        "Si no esperabas esta invitación, ignora este correo.",
      ],
      signature: SIGNATURE,
    }),
  };
}
