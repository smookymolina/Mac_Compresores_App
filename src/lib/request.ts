/** Lector mínimo de cabeceras (compatible con `Headers` y con el resultado de `headers()` de Next). */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * IP del cliente detrás de nginx: primer valor de X-Forwarded-For, luego X-Real-IP.
 * Devuelve "desconocida" si no hay ninguna (p. ej. en pruebas).
 */
export function clientIp(h: HeaderReader): string {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || "desconocida";
}
