import "server-only";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { dec, type Dec } from "@/lib/money";
import type { ConflictResult, StockConflictResult } from "./protocol";

/** Conflicto que gerencia resuelve en /sincronizacion: se guarda como CONFLICT con `result` (detalle por tipo). */
export class SyncConflictError<R extends ConflictResult = ConflictResult> extends AppError {
  constructor(message: string, public readonly result: R) {
    super(message, "CONFLICT");
  }
}

/** Partidas sin existencia suficiente en el almacén (saldo actual de StockBalance). Vacío si alcanza todo. */
export async function stockShortages(warehouseId: string, wanted: { productId: string; quantity: Dec }[]): Promise<StockConflictResult["items"]> {
  const need = new Map<string, Dec>();
  for (const w of wanted) need.set(w.productId, (need.get(w.productId) ?? dec(0)).add(w.quantity));
  const ids = [...need.keys()];
  const [products, balances] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, kind: true } }),
    db.stockBalance.findMany({ where: { warehouseId, productId: { in: ids } }, select: { productId: true, quantity: true } }),
  ]);
  const have = new Map(balances.map((b) => [b.productId, dec(b.quantity)]));
  return products
    .filter((p) => p.kind !== "SERVICE")
    .map((p) => ({ p, requested: need.get(p.id)!, available: have.get(p.id) ?? dec(0) }))
    .filter((x) => x.requested.gt(x.available))
    .map((x) => ({ productId: x.p.id, sku: x.p.sku, requested: x.requested.toString(), available: x.available.toString() }));
}

export const stockConflict = (warehouseId: string, items: StockConflictResult["items"]) =>
  new SyncConflictError("Sin existencia suficiente en el almacén. Gerencia debe decidir cómo surtir.", { kind: "stock", warehouseId, items });
