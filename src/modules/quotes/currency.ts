import { computeLine, dec, round2, sumLines, type Dec } from "@/lib/money";

export type QuoteCurrency = "MXN" | "USD";

type PresentableItem = {
  quantity: Dec; unitPrice: Dec; discountPct: Dec; taxRate: Dec;
  origCurrency: string; origUnitPrice: Dec | null; fxRate: Dec;
  subtotal: Dec; discount: Dec; tax: Dec; total: Dec;
};
type Presentable<I extends PresentableItem> = {
  currency: string; exchangeRate: Dec | null;
  items: I[]; subtotal: Dec; discountTotal: Dec; taxTotal: Dec; total: Dec;
};

/**
 * Montos para mostrar al cliente (PDF, correo, detalle). Internamente todo se guarda en MXN
 * (comisiones, ventas, reportes); si la cotización es en USD se convierten con su TC:
 * las partidas en USD conservan su precio de lista original y el resto se divide entre el TC.
 */
export function presentQuote<I extends PresentableItem, Q extends Presentable<I>>(q: Q): Q {
  if (q.currency !== "USD" || !q.exchangeRate || dec(q.exchangeRate).lte(0)) return q;
  const fx = dec(q.exchangeRate);
  const items = q.items.map((i) => {
    const keepsList = i.origCurrency === "USD" && i.origUnitPrice && round2(dec(i.origUnitPrice).mul(i.fxRate)).eq(i.unitPrice);
    const unitPrice = keepsList ? round2(dec(i.origUnitPrice)) : round2(i.unitPrice.div(fx));
    return { ...i, unitPrice, ...computeLine({ quantity: i.quantity, unitPrice, discountPct: i.discountPct, taxRate: i.taxRate }) };
  });
  return { ...q, items, ...sumLines(items) };
}
