import type { QuoteLostReason, QuoteStatus } from "@prisma/client";

/** Estados de pérdida: exigen motivo (validado en el servicio). */
export const LOST_STATUSES: readonly QuoteStatus[] = ["REJECTED", "CANCELLED"];
export const requiresLostReason = (to: QuoteStatus) => LOST_STATUSES.includes(to);

export const LOST_REASON_LABEL: Record<QuoteLostReason, string> = {
  PRICE: "Precio",
  COMPETITOR: "Eligió a la competencia",
  NO_BUDGET: "Sin presupuesto",
  NO_RESPONSE: "El cliente no respondió",
  TIMING: "Tiempo de entrega / fechas",
  REQUIREMENTS: "No cumple especificaciones",
  DUPLICATE: "Duplicada o capturada por error",
  ABANDONED: "Abandonada",
  OTHER: "Otro",
};
/** Motivos que un usuario puede elegir. ABANDONED lo pone solo el trabajo diario. */
export const MANUAL_LOST_REASONS = ["PRICE", "COMPETITOR", "NO_BUDGET", "NO_RESPONSE", "TIMING", "REQUIREMENTS", "DUPLICATE", "OTHER"] as const satisfies readonly QuoteLostReason[];

/** Valida el motivo de pérdida; devuelve un mensaje de error o null. */
export function lostReasonError(to: QuoteStatus, lost?: { reason?: string | null; note?: string | null }): string | null {
  if (!requiresLostReason(to)) return null;
  if (!lost?.reason || !(MANUAL_LOST_REASONS as readonly string[]).includes(lost.reason)) {
    return "Indica el motivo de pérdida para rechazar o cancelar la cotización.";
  }
  if (lost.reason === "OTHER" && !lost.note?.trim()) return "Describe el motivo cuando eliges «Otro».";
  return null;
}

/** Transiciones manuales permitidas. CONVERTED solo se alcanza al confirmar la venta. */
export const QUOTE_TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  DRAFT: ["SENT", "CANCELLED"],
  SENT: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  ACCEPTED: ["CANCELLED"],
  REJECTED: [],
  EXPIRED: [],
  CONVERTED: [],
  CANCELLED: [],
};

export function canTransition(from: QuoteStatus, to: QuoteStatus) {
  return QUOTE_TRANSITIONS[from].includes(to);
}

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  DRAFT: "Borrador",
  SENT: "Enviada",
  ACCEPTED: "Aceptada",
  REJECTED: "Rechazada",
  EXPIRED: "Vencida",
  CONVERTED: "Convertida en venta",
  CANCELLED: "Cancelada",
};
