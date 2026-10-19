/** Formato de fechas en hora de la Ciudad de México (igual en servidor y app móvil). */
export function fmtDate(d: Date | string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeZone: "America/Mexico_City" }).format(new Date(d));
}

export function fmtDateTime(d: Date | string) {
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "short", timeStyle: "short", timeZone: "America/Mexico_City" }).format(new Date(d));
}
