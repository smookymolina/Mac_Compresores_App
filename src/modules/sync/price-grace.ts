import "server-only";
import { db } from "@/lib/db";
import { catalogPriceMxn } from "@/domain/pricing";
import { dec, round2, type Dec } from "@/domain/money";
import type { PriceGrace } from "@/modules/quotes/service";
import type { PriceConflictResult, SyncQuotePayload } from "./protocol";
import { syncSettings } from "./settings";
import { SyncConflictError } from "./conflicts";

/**
 * Ventana de gracia de precios capturados sin conexión (docs/propuesta-offline-sync.md §5.3).
 * El servidor recalcula siempre; un precio distinto al vigente se respeta solo si el teléfono cotizó
 * hace ≤ N días y ese precio era el de catálogo en la hora de captura (PriceHistory + TC de ese momento).
 */

export interface GraceItem {
  index: number;
  productId: string;
  sku: string;
  currency: "MXN" | "USD";
  currentPrice: Dec;
  /** Precio vigente a la hora de captura en la moneda del producto (último PriceHistory ≤ capturedAt, o el actual). */
  historicalPrice: Dec;
  clientListPrice?: Dec;
}

export interface GraceInput {
  now: Date;
  capturedAt: Date;
  graceDays: number;
  usesUsd: boolean;
  serverFx: Dec | null;
  /** Último TC con createdAt ≤ capturedAt. */
  historicalFx: Dec | null;
  clientFx: Dec | null;
  items: GraceItem[];
  /** Gerencia aceptó los precios del teléfono (resolución «client»): se respetan sin revisar historial ni ventana. */
  force?: boolean;
}

export type GraceItemDiff = PriceConflictResult["items"][number];

export type GraceDecision =
  | { kind: "ok"; grace: PriceGrace; accepted: GraceItemDiff[]; exchangeRate?: { client: string; server: string | null } }
  | { kind: "conflict"; result: PriceConflictResult };

const s = (v: Dec | null) => (v ? v.toString() : null);

/** Decisión pura: qué precios del teléfono se respetan o si hay conflicto. */
export function decidePriceGrace(i: GraceInput): GraceDecision {
  const within = i.force || i.now.getTime() - i.capturedAt.getTime() <= i.graceDays * 864e5;
  const fxMismatch = !!(i.usesUsd && i.clientFx && i.serverFx && !i.clientFx.eq(i.serverFx));
  const fxOk = !fxMismatch || i.force || (within && !!i.historicalFx && i.clientFx!.eq(i.historicalFx));
  const effFx = fxMismatch && fxOk ? i.clientFx : i.serverFx;

  const prices = new Map<number, Dec>();
  const diffs: GraceItemDiff[] = [];
  let ok = fxOk;
  for (const it of i.items) {
    if (!it.clientListPrice) continue;
    if (it.currency === "USD" && !i.serverFx) continue; // buildItemSnapshots lo rechaza
    const client = round2(it.clientListPrice);
    const serverPrice = catalogPriceMxn({ price: it.currentPrice, currency: it.currency }, i.serverFx);
    const diff = { productId: it.productId, sku: it.sku, clientPrice: client.toString(), serverPrice: serverPrice.toString() };
    if (!client.eq(serverPrice)) diffs.push(diff);
    if (client.eq(catalogPriceMxn({ price: it.currentPrice, currency: it.currency }, effFx))) continue;
    const historical = it.currency === "MXN"
      ? round2(it.historicalPrice).eq(client)
      : !!i.historicalFx && !!i.clientFx && i.clientFx.eq(i.historicalFx)
        && catalogPriceMxn({ price: it.historicalPrice, currency: "USD" }, i.historicalFx).eq(client);
    if (i.force || (within && historical)) prices.set(it.index, client);
    else ok = false;
  }

  const exchangeRate = fxMismatch ? { client: i.clientFx!.toString(), server: s(i.serverFx) } : undefined;
  if (!ok) return { kind: "conflict", result: { kind: "price", items: diffs, ...(exchangeRate && { exchangeRate }) } };
  return { kind: "ok", grace: { prices, ...(fxMismatch && { fx: i.clientFx }) }, accepted: diffs, ...(exchangeRate && { exchangeRate }) };
}

/** Conflicto de precios: se guarda como CONFLICT con `result` para que gerencia decida. */
export class PriceConflictError extends SyncConflictError<PriceConflictResult> {
  constructor(result: PriceConflictResult) {
    super("Los precios cambiaron mientras el teléfono estaba sin conexión. Gerencia debe decidir qué precio aplicar.", result);
  }
}

/** Arma la entrada de `decidePriceGrace` desde la BD. `null` si el teléfono no mandó precios (nada que revisar). */
export async function evaluatePriceGrace(
  payload: Pick<SyncQuotePayload, "items" | "currency" | "clientExchangeRate">,
  capturedAt: Date,
  opts: { now?: Date; force?: boolean } = {},
): Promise<GraceDecision | null> {
  if (!payload.clientExchangeRate && !payload.items.some((it) => it.clientListPrice)) return null;
  const ids = [...new Set(payload.items.map((it) => it.productId))];
  const [products, history, serverFx, historicalFx, { priceGraceDays }] = await Promise.all([
    db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, price: true, currency: true } }),
    db.priceHistory.findMany({
      where: { productId: { in: ids }, createdAt: { lte: capturedAt } },
      distinct: ["productId"], orderBy: [{ productId: "asc" }, { createdAt: "desc" }], select: { productId: true, price: true },
    }),
    db.exchangeRate.findFirst({ orderBy: { createdAt: "desc" } }),
    db.exchangeRate.findFirst({ where: { createdAt: { lte: capturedAt } }, orderBy: { createdAt: "desc" } }),
    syncSettings(),
  ]);
  const byId = new Map(products.map((p) => [p.id, p]));
  const hist = new Map(history.map((h) => [h.productId, h.price]));
  const items: GraceItem[] = [];
  payload.items.forEach((it, index) => {
    const p = byId.get(it.productId);
    if (!p) return;
    items.push({
      index, productId: p.id, sku: p.sku, currency: p.currency, currentPrice: dec(p.price),
      historicalPrice: dec(hist.get(p.id) ?? p.price),
      clientListPrice: it.clientListPrice ? dec(it.clientListPrice) : undefined,
    });
  });
  return decidePriceGrace({
    now: opts.now ?? new Date(), capturedAt, graceDays: priceGraceDays, force: opts.force,
    usesUsd: payload.currency === "USD" || products.some((p) => p.currency === "USD"),
    serverFx: serverFx ? dec(serverFx.rate) : null,
    historicalFx: historicalFx ? dec(historicalFx.rate) : null,
    clientFx: payload.clientExchangeRate ? dec(payload.clientExchangeRate) : null,
    items,
  });
}
