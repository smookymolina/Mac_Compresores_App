import type { QuoteStatus } from "@prisma/client";

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
