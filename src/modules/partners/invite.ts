import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { renderEmail } from "@/lib/email-layout";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { logPartnerActivity } from "./activity";
import { hashPassword } from "./auth";

/** Vigencia del enlace de invitación o restablecimiento. */
export const INVITE_TTL_MS = 72 * 3_600_000;
export const MIN_PASSWORD = 10;

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const portalUrl = () => process.env.APP_URL?.trim().replace(/\/+$/, "") || "https://maccompresores.app";

/** Contraseña inutilizable (nadie la conoce) para socios con invitación pendiente. */
export const unusablePasswordHash = () => hashPassword(randomBytes(32).toString("base64url"));

/**
 * Genera un enlace nuevo (invalida el anterior) y lo envía por correo.
 * Devuelve la URL para que el admin la comparta a mano si el correo falla.
 */
export async function sendPartnerInvite(partnerId: string, ctx: { ip?: string | null } = {}): Promise<{ url: string; emailed: boolean }> {
  const token = randomBytes(32).toString("base64url");
  const p = await db.partner.update({
    where: { id: partnerId },
    data: { inviteTokenHash: sha256(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) },
    select: { id: true, name: true, email: true, passwordSetAt: true },
  });
  const url = `${portalUrl()}/socios/activar?t=${token}`;
  const first = !p.passwordSetAt;
  let emailed = false;
  if (isMailConfigured()) {
    try {
      const { html, text } = renderEmail({
        preheader: first ? "Activa tu acceso al portal de socios de MAC Compresores." : "Crea una contraseña nueva para el portal de socios.",
        eyebrow: "Portal de socios",
        title: first ? "Te damos la bienvenida al portal de socios" : "Restablece tu contraseña",
        greeting: `Hola ${p.name}:`,
        paragraphs: [first
          ? "MAC Compresores te dio acceso a su portal de precios para socios comerciales. Para entrar, crea tu contraseña con el botón de abajo."
          : "Se generó un enlace para que crees una contraseña nueva en el portal de socios."],
        cta: { label: first ? "Crear mi contraseña" : "Crear contraseña nueva", url },
        notes: [
          "El enlace sirve una sola vez y vence en 72 horas.",
          `Después entra en ${portalUrl()}/socios/login con este correo y tu contraseña.`,
          "Si no esperabas este correo, ignóralo.",
        ],
      });
      await sendMail({ to: p.email, subject: first ? "Activa tu acceso al portal de socios" : "Restablece tu contraseña del portal de socios", html, text });
      emailed = true;
    } catch (e) {
      console.error("[partners] no se pudo enviar la invitación", e instanceof Error ? e.message : e);
    }
  }
  await logPartnerActivity({ partnerId: p.id, type: "INVITE_SENT", meta: { emailed }, ip: ctx.ip ?? null });
  return { url, emailed };
}

/** Socio dueño de un enlace vigente, o null. */
export async function findInvite(token: string) {
  if (!token || token.length > 100) return null;
  const p = await db.partner.findUnique({
    where: { inviteTokenHash: sha256(token) },
    select: { id: true, name: true, email: true, status: true, inviteExpiresAt: true },
  });
  if (!p || p.status !== "ACTIVE" || !p.inviteExpiresAt || p.inviteExpiresAt < new Date()) return null;
  return p;
}

/** Fija la contraseña y consume el enlace (atómico: dos envíos en paralelo no pueden usarlo dos veces). */
export async function acceptInvite(token: string, password: string, ctx: { ip?: string | null; userAgent?: string | null } = {}): Promise<{ id: string }> {
  const p = await findInvite(token);
  if (!p) throw new AppError("El enlace venció o ya se usó. Pide uno nuevo a MAC Compresores.");
  if (password.length < MIN_PASSWORD) throw new AppError(`La contraseña debe tener al menos ${MIN_PASSWORD} caracteres.`);
  if (password.toLowerCase().includes(p.email.split("@")[0].toLowerCase())) throw new AppError("La contraseña no debe contener tu correo.");
  const res = await db.partner.updateMany({
    where: { id: p.id, inviteTokenHash: sha256(token) },
    data: { passwordHash: await hashPassword(password), passwordSetAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null, failedLogins: 0 },
  });
  if (res.count === 0) throw new AppError("El enlace venció o ya se usó. Pide uno nuevo a MAC Compresores.");
  // Una contraseña nueva cierra las sesiones abiertas con la anterior.
  await db.partnerSession.deleteMany({ where: { partnerId: p.id } });
  await logPartnerActivity({ partnerId: p.id, type: "PASSWORD_SET", ...ctx });
  return { id: p.id };
}
