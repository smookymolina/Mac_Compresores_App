/**
 * Teléfonos para WhatsApp (módulo puro: se usa en cliente y servidor).
 * Normaliza a formato internacional para wa.me: solo dígitos, sin «+». México (+52) por omisión.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  let d = s.replace(/\D/g, "");
  const international = s.startsWith("+") || d.startsWith("00");
  if (d.startsWith("00")) d = d.slice(2);
  if (!d) return null;

  if (!international) {
    if (d.length === 10) return `52${d}`; // nacional (10 dígitos)
    if ((d.startsWith("044") || d.startsWith("045")) && d.length === 13) return `52${d.slice(3)}`; // celular antiguo
    if (d.startsWith("01") && d.length === 12) return `52${d.slice(2)}`; // larga distancia antigua
  }
  if (d.startsWith("521") && d.length === 13) return `52${d.slice(3)}`; // «521» + 10: formato móvil antiguo
  if (d.startsWith("52")) return d.length === 12 ? d : null;
  return d.length >= 8 && d.length <= 15 ? d : null;
}

/** «525512345678» → «+52 55 1234 5678» (otros países: «+<dígitos>»). */
export function formatPhone(intl: string): string {
  const m = /^52(\d{2})(\d{4})(\d{4})$/.exec(intl);
  return m ? `+52 ${m[1]} ${m[2]} ${m[3]}` : `+${intl}`;
}

/** Enlace de WhatsApp con mensaje prellenado. */
export function whatsappUrl(intl: string, text: string): string {
  return `https://wa.me/${intl}?text=${encodeURIComponent(text)}`;
}
