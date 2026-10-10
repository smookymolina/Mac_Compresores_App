import "server-only";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { renderEmail } from "@/lib/email-layout";
import { QUOTE_SHARE_TTL_MS, createShareLink, loadShareUser, readShareToken } from "@/lib/share";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { can, type CurrentUser } from "@/lib/auth/session";
import { changeQuoteStatus, getQuote } from "./service";
import { renderQuotePdf } from "./pdf";

export const SENDABLE = new Set(["DRAFT", "SENT", "ACCEPTED"]);

/** Destinatario sugerido: correo del cliente o, si no tiene, el del primer contacto con correo. */
export function suggestedRecipient(q: Awaited<ReturnType<typeof getQuote>>) {
  return q.customer.email ?? q.customer.contacts.find((c) => c.email)?.email ?? "";
}

/** Teléfono sugerido para WhatsApp: el del cliente o, si no tiene, el del primer contacto con teléfono. */
export function suggestedPhone(q: Awaited<ReturnType<typeof getQuote>>) {
  return q.customer.phone ?? q.customer.contacts.find((c) => c.phone)?.phone ?? "";
}

/** Correo de marca de la cotización (HTML + texto). El mensaje del vendedor va en párrafos. */
export function quoteEmail(q: Awaited<ReturnType<typeof getQuote>>, message: string) {
  const total = `${fmtMoney(q.total)} ${q.currency}`;
  return renderEmail({
    preheader: `Cotización C-${q.folio} por ${total}, vigente hasta ${fmtDate(q.validUntil)}.`,
    eyebrow: "Cotización",
    title: `Cotización C-${q.folio}`,
    paragraphs: message.split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean),
    details: [
      { label: "Cliente", value: q.customer.legalName },
      { label: "Total", value: total },
      { label: "Vigente hasta", value: fmtDate(q.validUntil) },
      { label: "Vendedor", value: q.seller.name },
    ],
    notes: ["Adjuntamos la cotización en PDF. Para cualquier duda, responde a este correo y le llegará directamente a tu vendedor."],
    signature: [q.seller.name, q.seller.email, "MAC Compresores"],
  });
}

/**
 * Envía la cotización al cliente con el PDF adjunto. Reply-To = vendedor, para que la respuesta le llegue a él.
 * Un borrador pasa a «Enviada» solo si el correo salió.
 */
export async function emailQuote(user: CurrentUser, id: string, input: { to: string[]; cc: string[]; message: string }) {
  if (!isMailConfigured()) throw new AppError("El envío de correos no está configurado. Contacta al administrador.");
  const q = await getQuote(user, id); // control de acceso por objeto
  if (!SENDABLE.has(q.status)) throw new AppError("Solo se pueden enviar cotizaciones en borrador, enviadas o aceptadas.", "CONFLICT");

  const pdf = Buffer.from(await renderQuotePdf(q));
  const subject = `Cotización C-${q.folio} · MAC Compresores`;
  const { html, text } = quoteEmail(q, input.message);
  try {
    await sendMail({
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      replyTo: q.seller.email,
      subject,
      text,
      html,
      attachments: [{ filename: `cotizacion-C${q.folio}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    console.error("[mail] cotización:", e instanceof Error ? e.message : e);
    throw new AppError("No se pudo enviar el correo. Revisa la dirección e inténtalo de nuevo.");
  }

  await audit({ userId: user.id, action: "quote.email", entity: "Quote", entityId: id, data: { to: input.to, cc: input.cc } });
  if (q.status === "DRAFT") await changeQuoteStatus(user, id, "SENT");
}

/** Enlace público firmado al PDF (15 días) para compartir por WhatsApp. Mismas reglas que el correo. */
export async function shareQuoteLink(user: CurrentUser, id: string) {
  const q = await getQuote(user, id);
  if (!SENDABLE.has(q.status)) throw new AppError("Solo se pueden enviar cotizaciones en borrador, enviadas o aceptadas.", "CONFLICT");
  return createShareLink(`/api/compartir/cotizacion/${q.id}`, { t: "quote", id: q.id, u: user.id }, QUOTE_SHARE_TTL_MS);
}

/**
 * Registra el envío por WhatsApp (enlace o archivo compartido desde el dispositivo).
 * Igual que con el correo, un borrador pasa a «Enviada».
 */
export async function logQuoteWhatsApp(user: CurrentUser, id: string, input: { phone: string | null; channel: "link" | "file" }) {
  const q = await getQuote(user, id);
  if (!SENDABLE.has(q.status)) throw new AppError("Solo se pueden enviar cotizaciones en borrador, enviadas o aceptadas.", "CONFLICT");
  await audit({ userId: user.id, action: "quote.whatsapp", entity: "Quote", entityId: id, data: { phone: input.phone, channel: input.channel } });
  if (q.status === "DRAFT") await changeQuoteStatus(user, id, "SENT");
}

/**
 * Cotización de un enlace público: valida firma, vencimiento e id, y la carga con el alcance de quien la compartió.
 * null = enlace inválido, vencido o cotización ya no disponible (cancelada o fuera de su alcance).
 */
export async function loadSharedQuote(token: string | null, id: string) {
  const p = readShareToken(token);
  if (!p || p.t !== "quote" || p.id !== id) return null;
  const user = await loadShareUser(p.u);
  if (!user || !(can(user, "quotes.read_all") || can(user, "quotes.read_own"))) return null;
  const q = await getQuote(user, id).catch(() => null);
  if (!q || q.status === "CANCELLED") return null;
  return q;
}
