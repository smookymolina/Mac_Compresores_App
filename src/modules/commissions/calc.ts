import type { CommissionBasis, ProductLine } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { dec, round2, type Dec } from "@/lib/money";

export interface SaleLineForCommission {
  sellerId: string;
  line: ProductLine;
  quantity: Dec;
  subtotal: Dec;
  discount: Dec;
  unitCost: Dec;
}

export interface RateRow {
  line: ProductLine;
  rateMet: Dec;
  rateNotMet: Dec;
}

export interface CalculatedEntry {
  sellerId: string;
  line: ProductLine;
  baseAmount: Dec;
  sellerTotal: Dec;
  targetAmount: Dec;
  metTarget: boolean;
  rate: Dec;
  amount: Dec;
}

export function lineBase(basis: CommissionBasis, l: SaleLineForCommission): Dec {
  const net = l.subtotal.sub(l.discount);
  if (basis === "NET_SALES") return net;
  if (basis === "MARGIN") return net.sub(l.unitCost.mul(l.quantity));
  throw new AppError("La base 'cobranza' requiere el módulo de cobranza (no disponible).");
}

/**
 * Esquema de meta (tabla verde/rojo): si la base total del vendedor en el periodo alcanza su meta,
 * todas sus líneas usan la tasa "meta cumplida"; si no, la tasa "meta no cumplida".
 * No es progresivo por tramos.
 */
export function calculateCommissions(
  basis: CommissionBasis,
  lines: SaleLineForCommission[],
  rates: RateRow[],
  targets: Map<string, Dec>,
): CalculatedEntry[] {
  const rateByLine = new Map(rates.map((r) => [r.line, r]));
  const bySeller = new Map<string, Map<ProductLine, Dec>>();

  for (const l of lines) {
    const perLine = bySeller.get(l.sellerId) ?? new Map<ProductLine, Dec>();
    perLine.set(l.line, (perLine.get(l.line) ?? dec(0)).add(lineBase(basis, l)));
    bySeller.set(l.sellerId, perLine);
  }

  const out: CalculatedEntry[] = [];
  for (const [sellerId, perLine] of bySeller) {
    const sellerTotal = round2([...perLine.values()].reduce((a, b) => a.add(b), dec(0)));
    const targetAmount = targets.get(sellerId) ?? dec(0);
    const metTarget = targetAmount.gt(0) && sellerTotal.gte(targetAmount);
    for (const [line, base] of perLine) {
      const r = rateByLine.get(line);
      if (!r) throw new AppError(`La regla no define tasa para la línea ${line}.`);
      const rate = metTarget ? r.rateMet : r.rateNotMet;
      const baseAmount = round2(base);
      const amount = baseAmount.gt(0) ? round2(baseAmount.mul(rate)) : dec(0);
      out.push({ sellerId, line, baseAmount, sellerTotal, targetAmount, metTarget, rate, amount });
    }
  }
  return out;
}
