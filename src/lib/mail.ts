import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

let transporter: Transporter | null = null;

function env(name: string) {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

/** SMTP configurado por variables de entorno. TLS implícito en 465 (secure) y certificados siempre validados. */
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT ?? 465);
    transporter = nodemailer.createTransport({
      host: env("SMTP_HOST"),
      port,
      secure: port === 465,
      requireTLS: true,
      auth: { user: env("SMTP_USER"), pass: env("SMTP_PASS") },
      tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
    });
  }
  return transporter;
}

export function isMailConfigured() {
  return ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_EMAIL"].every((k) => !!process.env[k]?.trim());
}

export async function sendMail(msg: MailMessage) {
  await getTransporter().sendMail({
    from: { name: process.env.SMTP_FROM_NAME?.trim() || "MAC Compresores", address: env("SMTP_FROM_EMAIL") },
    to: msg.to,
    replyTo: msg.replyTo,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
  });
}
