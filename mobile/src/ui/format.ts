import { dec, fmtMoney, round2 } from "@domain/money";
import { QUOTE_STATUS_LABEL } from "@domain/quote-status";
import type { QuoteStatus } from "@domain/types";

/** «hace 5 min», «hace 2 h», «hace 3 días». */
export function timeAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "nunca";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "hace un momento";
  const m = Math.round(s / 60);
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

/** Monto con su moneda (fmtMoney da el símbolo; se agrega el código para distinguir USD). */
export function money(v: unknown, currency: string = "MXN"): string {
  return `${fmtMoney(v as string)} ${currency}`;
}

/** Totales de cotización: se guardan en MXN; si es USD se dividen entre su tipo de cambio. */
export function quoteTotal(q: Record<string, unknown>): string {
  const fx = q.exchangeRate ? dec(q.exchangeRate as string) : null;
  if (q.currency === "USD" && fx && fx.gt(0)) return money(round2(dec(q.total as string).div(fx)), "USD");
  return money(q.total, "MXN");
}

export const qty = (v: unknown) => dec((v ?? 0) as string).toDecimalPlaces(2).toString();

export const LINE_LABEL: Record<string, string> = {
  EQUIPO_VENTA: "Venta de equipos",
  RENTA: "Renta de equipos",
  REFACCIONES: "Refacciones",
  TUBERIA: "Tubería e instalaciones",
  SERVICIOS: "Servicios",
  KITS: "Kits para tornillo",
  VALVULAS_OTROS: "Válvulas y otros",
};

export const quoteStatus = (s: unknown) => QUOTE_STATUS_LABEL[s as QuoteStatus] ?? String(s ?? "");
export const saleStatus = (s: unknown) => (s === "CONFIRMED" ? "Confirmada" : s === "CANCELLED" ? "Cancelada" : String(s ?? ""));

export const ENTITY_LABEL: Record<string, string> = {
  Product: "Productos",
  Customer: "Clientes",
  Quote: "Cotizaciones",
  Sale: "Ventas",
  StockBalance: "Existencias",
  Warehouse: "Almacenes",
  ExchangeRate: "Tipo de cambio",
  ComplementPackage: "Paquetes de complementos",
};

export const str = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
