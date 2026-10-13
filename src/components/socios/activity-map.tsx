import type { PartnerActivityType } from "@prisma/client";
import type { Tone } from "@/components/ui/badge";

export type Severity = "info" | "warning" | "critical";
export const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  info: { label: "Información", tone: "blue" },
  warning: { label: "Advertencia", tone: "amber" },
  critical: { label: "Crítico", tone: "red" },
};

/** Etiqueta y severidad de cada evento (docs/partners-ui-spec.md §7). Debe cubrir todo PartnerActivityType. */
export const ACTIVITY: Record<PartnerActivityType, { label: string; severity: Severity }> = {
  LOGIN_OK: { label: "Inició sesión", severity: "info" },
  LOGIN_FAIL: { label: "Inicio de sesión fallido", severity: "warning" },
  TOTP_OK: { label: "Verificó su código 2FA", severity: "info" },
  TOTP_FAIL: { label: "Código 2FA incorrecto", severity: "warning" },
  TOTP_SETUP: { label: "Activó la verificación 2FA", severity: "info" },
  BACKUP_CODE_USED: { label: "Usó un código de respaldo", severity: "warning" },
  SEARCH: { label: "Buscó precios", severity: "info" },
  PRICE_VIEW: { label: "Vio un precio", severity: "info" },
  LOGOUT: { label: "Cerró sesión", severity: "info" },
  SESSION_REVOKED: { label: "Sesión cerrada por otro inicio", severity: "info" },
  QUOTA_EXCEEDED: { label: "Excedió su cuota diaria", severity: "critical" },
  RATE_LIMITED: { label: "Búsquedas demasiado rápidas", severity: "warning" },
  AUTO_BLOCK: { label: "Bloqueo automático", severity: "critical" },
  SWEEP_SUSPECT: { label: "Búsquedas en barrido sospechosas", severity: "warning" },
  HIDDEN: { label: "Salió de la pestaña", severity: "info" },
  PRINT_ATTEMPT: { label: "Intentó imprimir", severity: "warning" },
  COPY_ATTEMPT: { label: "Intentó copiar", severity: "warning" },
  CAPTURE_KEY: { label: "Presionó tecla de captura", severity: "warning" },
  DEVTOOLS: { label: "Abrió herramientas de desarrollo", severity: "warning" },
  WEBDRIVER: { label: "Navegador automatizado detectado", severity: "critical" },
  HONEYPOT: { label: "Entró a un enlace trampa", severity: "critical" },
  ADMIN_CHANGE: { label: "Cambio hecho por un administrador", severity: "info" },
};

/** Categorías del selector de tipo de evento. */
export const ACTIVITY_GROUPS: { label: string; types: PartnerActivityType[] }[] = [
  { label: "Acceso", types: ["LOGIN_OK", "LOGIN_FAIL", "TOTP_OK", "TOTP_FAIL", "TOTP_SETUP", "BACKUP_CODE_USED", "LOGOUT", "SESSION_REVOKED"] },
  { label: "Consulta", types: ["SEARCH", "PRICE_VIEW"] },
  { label: "Límites", types: ["QUOTA_EXCEEDED", "RATE_LIMITED", "SWEEP_SUSPECT", "AUTO_BLOCK"] },
  { label: "Seguridad", types: ["HIDDEN", "PRINT_ATTEMPT", "COPY_ATTEMPT", "CAPTURE_KEY", "DEVTOOLS", "WEBDRIVER", "HONEYPOT"] },
  { label: "Administración", types: ["ADMIN_CHANGE"] },
];

const ADMIN_ACTIONS: Record<string, string> = {
  create: "Alta del socio", update: "Edición de datos", block: "Bloqueo de acceso", unblock: "Desbloqueo de acceso", reset_2fa: "Restablecimiento de 2FA",
};

/** Resumen corto y seguro de `meta` para la columna Detalle (solo valores primitivos, texto plano). */
export function activityDetail(type: PartnerActivityType, meta: unknown): string {
  const m = (meta && typeof meta === "object" && !Array.isArray(meta) ? meta : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof m[k] === "string" || typeof m[k] === "number" ? String(m[k]) : "");
  switch (type) {
    case "SEARCH": return [s("term") && `“${s("term")}”`, s("count") !== "" && `${s("count")} resultados`].filter(Boolean).join(" · ");
    case "ADMIN_CHANGE": return [ADMIN_ACTIONS[s("action")] ?? s("action"), s("reason")].filter(Boolean).join(" · ");
    case "PRICE_VIEW": return "";
    case "SESSION_REVOKED": return s("reason") === "new_login" ? "Nuevo inicio de sesión" : "";
    case "QUOTA_EXCEEDED": return s("quota") ? `Cuota ${s("quota")}` : "";
    case "AUTO_BLOCK": return s("reason");
    case "RATE_LIMITED": return s("scope") ? `Límite por ${s("scope") === "ip" ? "IP" : "minuto"}` : "";
    case "SWEEP_SUSPECT": return [s("term") && `“${s("term")}”`, s("reason")].filter(Boolean).join(" · ");
    default: {
      const parts = Object.entries(m).filter(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean").slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`);
      return parts.join(" · ");
    }
  }
}
