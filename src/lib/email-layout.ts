import "server-only";

/**
 * Plantilla HTML de correo con la identidad MAC Compresores (mismos colores que maccompresores.com.mx).
 * Tablas + estilos en línea: es lo único que respetan Gmail, Outlook y Apple Mail. Sin imágenes de fondo ni CSS externo.
 */

export const SITE_URL = "https://maccompresores.com.mx";
/** Logos oficiales, servidos desde el sitio web de la empresa. */
export const LOGO_H_URL = "https://maccompresores.com.mx/wp-content/uploads/2026/04/mac-compresores-logo-H.png";
export const LOGO_URL = "https://maccompresores.com.mx/wp-content/uploads/2026/04/mac-compresores-logo.png";

const C = {
  brand: "#046bd2",
  brandDark: "#045cb4",
  slate: "#1e293b",
  slate2: "#334155",
  muted: "#64748b",
  bg: "#f0f5fa",
  border: "#e2e8f0",
  white: "#ffffff",
};
const FONT = "'IBM Plex Sans','Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Texto plano del usuario → HTML seguro con saltos de línea. */
export const textToHtml = (s: string) => escapeHtml(s).replace(/\r?\n/g, "<br>");

export interface EmailDetail {
  label: string;
  value: string;
}

export interface EmailOptions {
  /** Texto corto que los clientes de correo muestran junto al asunto. */
  preheader: string;
  /** Rótulo pequeño sobre el título (p. ej. «Cotización», «Cobranza»). */
  eyebrow?: string;
  title: string;
  /** Saludo, p. ej. «Hola Juan:». */
  greeting?: string;
  /** Párrafos en texto plano (se escapan). */
  paragraphs: string[];
  /** Ficha de datos clave (folio, total, vencimiento…). */
  details?: EmailDetail[];
  /** Botón principal. */
  cta?: { label: string; url: string };
  /** Párrafos pequeños después del botón (avisos, vigencia del enlace…). */
  notes?: string[];
  /** Firma, una línea por elemento. */
  signature?: string[];
}

/** Devuelve el HTML de marca y su versión en texto plano (multipart, mejor entregabilidad). */
export function renderEmail(o: EmailOptions): { html: string; text: string } {
  const p = (s: string) =>
    `<p style="margin:0 0 16px;font:400 15px/1.6 ${FONT};color:${C.slate2};">${textToHtml(s)}</p>`;

  const details = o.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;border:1px solid ${C.border};border-left:4px solid ${C.brand};border-radius:6px;background:${C.bg};">` +
      o.details
        .map(
          (d, i) =>
            `<tr><td style="padding:10px 16px;${i ? `border-top:1px solid ${C.border};` : ""}font:400 13px/1.4 ${FONT};color:${C.muted};">${escapeHtml(d.label)}</td>` +
            `<td align="right" style="padding:10px 16px;${i ? `border-top:1px solid ${C.border};` : ""}font:600 14px/1.4 ${FONT};color:${C.slate};">${escapeHtml(d.value)}</td></tr>`,
        )
        .join("") +
      `</table>`
    : "";

  const cta = o.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px;"><tr><td style="border-radius:4px;background:${C.brand};">` +
      `<a href="${escapeHtml(o.cta.url)}" style="display:inline-block;padding:13px 28px;font:600 15px/1 ${FONT};color:${C.white};text-decoration:none;border-radius:4px;">${escapeHtml(o.cta.label)}</a>` +
      `</td></tr></table>` +
      `<p style="margin:0 0 16px;font:400 12px/1.5 ${FONT};color:${C.muted};">Si el botón no funciona, copia este enlace en tu navegador:<br>` +
      `<a href="${escapeHtml(o.cta.url)}" style="color:${C.brandDark};word-break:break-all;">${escapeHtml(o.cta.url)}</a></p>`
    : "";

  const notes = (o.notes ?? [])
    .map((n) => `<p style="margin:0 0 12px;font:400 13px/1.5 ${FONT};color:${C.muted};">${textToHtml(n)}</p>`)
    .join("");

  const signature = o.signature?.length
    ? `<p style="margin:24px 0 0;font:400 14px/1.6 ${FONT};color:${C.slate2};">${o.signature.map(escapeHtml).join("<br>")}</p>`
    : "";

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><title>${escapeHtml(o.title)}</title></head>
<body style="margin:0;padding:0;background:${C.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(o.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:${C.white};border:1px solid ${C.border};border-radius:8px;overflow:hidden;">
  <tr><td style="padding:20px 32px;background:${C.white};border-bottom:1px solid ${C.border};">
    <a href="${SITE_URL}" style="text-decoration:none;"><img src="${LOGO_H_URL}" width="200" alt="MAC Compresores" style="display:block;width:200px;max-width:100%;height:auto;border:0;"></a>
  </td></tr>
  <tr><td style="height:4px;line-height:4px;font-size:0;background:${C.brand};">&nbsp;</td></tr>
  <tr><td style="padding:32px 32px 8px;">
    ${o.eyebrow ? `<p style="margin:0 0 8px;font:600 12px/1 ${FONT};letter-spacing:.08em;text-transform:uppercase;color:${C.brand};">${escapeHtml(o.eyebrow)}</p>` : ""}
    <h1 style="margin:0 0 20px;font:600 22px/1.3 ${FONT};color:${C.slate};">${escapeHtml(o.title)}</h1>
    ${o.greeting ? p(o.greeting) : ""}
    ${o.paragraphs.map(p).join("")}
    ${details}
    ${cta}
    ${notes}
    ${signature}
  </td></tr>
  <tr><td style="padding:24px 32px;background:${C.slate};">
    <p style="margin:0 0 6px;font:600 14px/1.4 ${FONT};color:${C.white};">MAC Compresores</p>
    <p style="margin:0 0 6px;font:400 12px/1.5 ${FONT};color:#cbd5e1;">Venta, renta y servicio de compresores de aire industriales.</p>
    <p style="margin:0;font:400 12px/1.5 ${FONT};"><a href="${SITE_URL}" style="color:#6db0ff;text-decoration:none;">maccompresores.com.mx</a></p>
  </td></tr>
</table>
<p style="margin:16px 0 0;font:400 11px/1.5 ${FONT};color:${C.muted};">Este correo fue enviado por el sistema de MAC Compresores.</p>
</td></tr></table>
</body></html>`;

  const text = [
    o.title,
    "",
    ...(o.greeting ? [o.greeting, ""] : []),
    ...o.paragraphs.flatMap((s) => [s, ""]),
    ...(o.details ?? []).map((d) => `${d.label}: ${d.value}`),
    ...(o.details?.length ? [""] : []),
    ...(o.cta ? [`${o.cta.label}: ${o.cta.url}`, ""] : []),
    ...(o.notes ?? []).flatMap((s) => [s, ""]),
    ...(o.signature ?? []),
    ...(o.signature?.length ? [""] : []),
    "—",
    "MAC Compresores · " + SITE_URL,
  ].join("\n");

  return { html, text };
}
