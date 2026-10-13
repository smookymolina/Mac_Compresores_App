/** Lector mínimo de cabeceras (compatible con `Headers` y con el resultado de `headers()` de Next). */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * IP del cliente detrás de nginx: X-Real-IP (nginx la fija con $remote_addr; el cliente no la controla)
 * y, si falta, el ÚLTIMO valor de X-Forwarded-For (el que añade nginx; los primeros los puede inventar el cliente).
 * Devuelve "desconocida" si no hay ninguna (p. ej. en pruebas).
 */
export function clientIp(h: HeaderReader): string {
  return h.get("x-real-ip")?.trim() || h.get("x-forwarded-for")?.split(",").pop()?.trim() || "desconocida";
}
