/** Configuración de compilación. `VITE_API_URL` = origen del ERP (p. ej. https://erp.ejemplo.mx). */
export const API_URL: string = (import.meta.env?.VITE_API_URL ?? "").replace(/\/+$/, "");
export const APP_VERSION: string = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.0.0";
export const SYNC_INTERVAL_MS = 5 * 60_000;
