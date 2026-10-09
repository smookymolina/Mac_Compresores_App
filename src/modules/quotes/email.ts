import "server-only";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import type { CurrentUser } from "@/lib/auth/session";
import { changeQuoteStatus, getQuote } from "./service";
import { renderQuotePdf } from "./pdf";

const SENDABLE = new Set(["DRAFT", "SENT", "ACCEPTED"]);

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Destinatario sugerido: correo del cliente o, si no tiene, el del primer contacto con correo. */
export function suggestedRecipient(q: Awaited<ReturnType<typeof getQuote>>) {
  return q.customer.email ?? q.customer.contacts.find((c) => c.email)?.email ?? "";
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
  const summary = `Total: ${fmtMoney(q.total)} ${q.currency} · Vigente hasta ${fmtDate(q.validUntil)}`;
  try {
    await sendMail({
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      replyTo: q.seller.email,
      subject,
      text: `${input.message}\n\n${summary}\n\n${q.seller.name}\nMAC Compresores`,
      html:
        `<p>${escapeHtml(input.message).replace(/\n/g, "<br>")}</p>` +
        `<p><b>${escapeHtml(summary)}</b></p>` +
        `<p>${escapeHtml(q.seller.name)}<br>MAC Compresores</p>`,
      attachments: [{ filename: `cotizacion-C${q.folio}.pdf`, content: pdf, contentType: "application/pdf" }],
    });
  } catch (e) {
    console.error("[mail] cotización:", e instanceof Error ? e.message : e);
    throw new AppError("No se pudo enviar el correo. Revisa la dirección e inténtalo de nuevo.");
  }

  await audit({ userId: user.id, action: "quote.email", entity: "Quote", entityId: id, data: { to: input.to, cc: input.cc } });
  if (q.status === "DRAFT") await changeQuoteStatus(user, id, "SENT");
}
