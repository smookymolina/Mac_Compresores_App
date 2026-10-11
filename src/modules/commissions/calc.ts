import type { ProductLine } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { dec, round2, type Dec } from "@/lib/money";

/*
 * Reglas de comisión (meta mensual):
 * - La meta se evalúa con la VENTA TOTAL del mes (O.C. = ventas confirmadas en el mes, neto sin IVA),
 *   cobradas o no.
 * - Solo genera comisión una venta COBRADA al 100% dentro del periodo; se paga en el mes del cobro.
 * - La comisión se calcula sobre la UTILIDAD NETA después de gastos (precio neto − costo total − gastos de la venta).
 * - El % (alto = meta cumplida / bajo = no cumplida) es el del MES DE LA O.C., aunque se cobre en un mes posterior.
 */

export interface SaleLineForCommission {
  line: ProductLine;
  quantity: Dec;
  subtotal: Dec;
  discount: Dec;
  unitCost: Dec; // costo total por unidad (base + traslado + consumibles)
}

export interface RateRow {
  line: ProductLine;
  rateMet: Dec;
  rateNotMet: Dec;
}

export interface PaymentForCommission {
  amount: Dec;
  paidAt: Date;
}

/** Fecha en que los pagos (no anulados, en orden) cubren el total de la venta; null si aún tiene saldo. */
export function collectedAt(total: Dec, payments: PaymentForCommission[]): Date | null {
  let acc = dec(0);
  for (const p of [...payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime())) {
    acc = acc.add(p.amount);
    if (acc.gte(total)) return p.paidAt;
  }
  return null;
}

/** Meta cumplida: venta total del mes ≥ meta (> 0). */
export function metTarget(monthTotal: Dec, target: Dec | undefined): boolean {
  return !!target && target.gt(0) && monthTotal.gte(target);
}

/** Utilidad neta por línea comercial: (neto − costo) de cada partida, menos los gastos de la venta prorrateados por neto. */
export function netProfitByLine(lines: SaleLineForCommission[], expenses: Dec): Map<ProductLine, Dec> {
  const net = new Map<ProductLine, Dec>();
  const profit = new Map<ProductLine, Dec>();
  for (const l of lines) {
    const n = l.subtotal.sub(l.discount);
    net.set(l.line, (net.get(l.line) ?? dec(0)).add(n));
    profit.set(l.line, (profit.get(l.line) ?? dec(0)).add(n.sub(l.unitCost.mul(l.quantity))));
  }
  const totalNet = [...net.values()].reduce((a, b) => a.add(b), dec(0));
  if (expenses.gt(0)) {
    for (const [line, p] of profit) {
      const share = totalNet.gt(0) ? net.get(line)!.div(totalNet) : dec(1).div(profit.size);
      profit.set(line, p.sub(expenses.mul(share)));
    }
  }
  return profit;
}

export interface CalculatedLine {
  line: ProductLine;
  baseAmount: Dec;
  rate: Dec;
  amount: Dec;
}

/** Comisión de una venta cobrada, con el % que corresponde al mes de su O.C. */
export function commissionForSale(
  lines: SaleLineForCommission[],
  expenses: Dec,
  rates: RateRow[],
  originMet: boolean,
): CalculatedLine[] {
  const rateByLine = new Map(rates.map((r) => [r.line, r]));
  return [...netProfitByLine(lines, expenses)].map(([line, base]) => {
    const r = rateByLine.get(line);
    if (!r) throw new AppError(`La regla no define tasa para la línea ${line}.`);
    const rate = originMet ? r.rateMet : r.rateNotMet;
    const baseAmount = round2(base);
    return { line, baseAmount, rate, amount: baseAmount.gt(0) ? round2(baseAmount.mul(rate)) : dec(0) };
  });
}
