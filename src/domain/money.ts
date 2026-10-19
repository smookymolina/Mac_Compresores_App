import Decimal from "decimal.js";

/**
 * Decimal de decimal.js, la misma librería sobre la que está construido Prisma.Decimal
 * (misma configuración por omisión: precision 20, ROUND_HALF_UP). Prisma acepta estas
 * instancias como entrada de campos Decimal.
 */
export const D = Decimal;
export type Dec = Decimal;
/** Valor tipo decimal de otra instancia de la librería (p. ej. Prisma.Decimal leído de BD). */
export interface DecimalLike {
  d: number[];
  e: number;
  s: number;
  toFixed(): string;
}
export type DecInput = Dec | DecimalLike | string | number;

const ZERO = new D(0);

export function dec(v: DecInput | null | undefined): Dec {
  if (v === null || v === undefined || v === "") return ZERO;
  if (typeof v === "string" || typeof v === "number" || v instanceof D) return new D(v);
  return new D(v.toFixed());
}

/** Redondeo comercial a 2 decimales (half-up). */
export function round2(v: Dec): Dec {
  return v.toDecimalPlaces(2, D.ROUND_HALF_UP);
}

export interface LineInput {
  quantity: DecInput;
  unitPrice: DecInput;
  discountPct: DecInput; // fracción 0..1
  taxRate: DecInput; // fracción 0..1
}

export interface LineAmounts {
  subtotal: Dec;
  discount: Dec;
  tax: Dec;
  total: Dec;
}

export function computeLine(i: LineInput): LineAmounts {
  const subtotal = round2(dec(i.quantity).mul(dec(i.unitPrice)));
  const discount = round2(subtotal.mul(dec(i.discountPct)));
  const tax = round2(subtotal.sub(discount).mul(dec(i.taxRate)));
  return { subtotal, discount, tax, total: subtotal.sub(discount).add(tax) };
}

export function sumLines(lines: LineAmounts[]) {
  return lines.reduce(
    (acc, l) => ({
      subtotal: acc.subtotal.add(l.subtotal),
      discountTotal: acc.discountTotal.add(l.discount),
      taxTotal: acc.taxTotal.add(l.tax),
      total: acc.total.add(l.total),
    }),
    { subtotal: ZERO, discountTotal: ZERO, taxTotal: ZERO, total: ZERO },
  );
}

/** Precio de lista según la hoja "Lista precios": costo + costo*utilidad + envío. */
/** Precio al cliente (en la moneda del producto) = base (costo + utilidad) + traslado + consumibles. */
export function listPrice(cost: DecInput, markup: DecInput, shipping: DecInput, consumables: DecInput = 0): Dec {
  const c = dec(cost);
  return round2(c.add(c.mul(dec(markup))).add(dec(shipping)).add(dec(consumables)));
}

/** Convierte a MXN un importe en la moneda indicada con el tipo de cambio USD→MXN. */
export function toMxn(amount: DecInput, currency: "MXN" | "USD", fx: DecInput): Dec {
  return currency === "USD" ? dec(amount).mul(dec(fx)) : dec(amount);
}

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export function fmtMoney(v: DecInput | null | undefined): string {
  return mxn.format(dec(v).toNumber()); // solo presentación
}

export function fmtPct(v: DecInput | null | undefined): string {
  return `${dec(v).mul(100).toDecimalPlaces(2).toString()}%`;
}
