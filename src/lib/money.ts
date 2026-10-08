import { Prisma } from "@prisma/client";

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
export type DecInput = Prisma.Decimal | string | number;

const ZERO = new D(0);

export function dec(v: DecInput | null | undefined): Dec {
  return v === null || v === undefined || v === "" ? ZERO : new D(v);
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
export function listPrice(cost: DecInput, markup: DecInput, shipping: DecInput): Dec {
  const c = dec(cost);
  return round2(c.add(c.mul(dec(markup))).add(dec(shipping)));
}

const mxn = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
export function fmtMoney(v: DecInput | null | undefined): string {
  return mxn.format(dec(v).toNumber()); // solo presentación
}

export function fmtPct(v: DecInput | null | undefined): string {
  return `${dec(v).mul(100).toDecimalPlaces(2).toString()}%`;
}
