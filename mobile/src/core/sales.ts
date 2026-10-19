import { dec, type Dec } from "@domain/money";
import type { EntityRow } from "./api";
import { LocalRuleError, LocalService, clean, type EntitySync } from "./local";
import { quoteFolioLabel, type LocalQuote, type LocalQuoteItem } from "./quotes";

// ---------- Tipos ----------

/** `PENDING_SYNC` = venta capturada en el teléfono que el servidor aún no confirma. */
export type LocalSaleStatus = "CONFIRMED" | "CANCELLED" | "PENDING_SYNC";
export type PaymentMethod = "TRANSFER" | "CASH" | "CARD" | "CHECK" | "OTHER";

export interface LocalPayment {
  id: string;
  saleId: string;
  amount: string;
  paidAt: string;
  method: PaymentMethod;
  reference: string | null;
  voidedAt: string | null;
  createdAt?: string;
  /** Solo en pagos capturados en el teléfono. */
  _sync?: EntitySync;
}

export type LocalSaleItem = Omit<LocalQuoteItem, "id"> & { id: string };

/** Fila local de Sale: forma de `/api/sync/pull` (items + payments) o venta pendiente del teléfono. */
export interface LocalSale extends EntityRow {
  id: string;
  folio: number | null;
  quoteId: string;
  quoteFolio: number | null;
  customerId: string;
  customerName: string;
  sellerId: string;
  warehouseId: string;
  status: LocalSaleStatus;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  confirmedAt: string | null;
  items: LocalSaleItem[];
  payments: LocalPayment[];
  /** Venta pendiente: `_sync` del `sale.convert`. */
  _sync?: EntitySync;
  /** Id real de la venta (resultado APPLIED de `sale.convert`), hasta que llegue por pull. */
  serverSaleId?: string;
  /** Avisos de existencia al convertir (vista previa local). */
  stockWarnings?: StockWarning[];
}

export interface StockWarning { productId: string; sku: string; requested: string; available: string }
export interface SaleBalance { total: Dec; paid: Dec; pendingPaid: Dec; balance: Dec }
export interface PaymentInput { amount: string; method: PaymentMethod; /** `yyyy-mm-dd` (por omisión hoy). */ paidAt?: string; reference?: string | null }

export const PENDING_SALE_LABEL = "Venta pendiente";
/** Id local de la venta pendiente de una cotización (nunca viaja al servidor). */
export const pendingSaleId = (quoteId: string) => `pending-sale:${quoteId}`;
export const isPendingSale = (s: Pick<LocalSale, "status">) => s.status === "PENDING_SYNC";
/** `V-123` o «Venta pendiente». */
export const saleFolioLabel = (s: Pick<LocalSale, "folio" | "status">) =>
  s.folio !== null && s.folio !== undefined ? `V-${s.folio}` : PENDING_SALE_LABEL;

const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const countsAsPaid = (p: LocalPayment) => !p.voidedAt && (!p._sync || p._sync.state === "applied");
const countsAsPending = (p: LocalPayment) => !p.voidedAt && p._sync?.state === "pending";

/** Saldo = total − pagos no cancelados − pagos locales pendientes (rechazados/en conflicto no cuentan). */
export function saleBalance(s: Pick<LocalSale, "total" | "payments">): SaleBalance {
  const sum = (f: (p: LocalPayment) => boolean) => (s.payments ?? []).filter(f).reduce((a, p) => a.add(dec(p.amount)), dec(0));
  const total = dec(s.total), paid = sum(countsAsPaid), pendingPaid = sum(countsAsPending);
  return { total, paid, pendingPaid, balance: total.sub(paid).sub(pendingPaid) };
}

// ---------- Servicio ----------

/** Ventas locales: conversión de cotización aceptada (venta pendiente) y pagos. */
export class SalesService extends LocalService {
  /** Existencia local vs. lo requerido (solo productos). Avisa; no bloquea. */
  async previewStock(items: Pick<LocalQuoteItem, "productId" | "kind" | "sku" | "quantity">[], warehouseId: string): Promise<StockWarning[]> {
    const need = new Map<string, { sku: string; q: Dec }>();
    for (const i of items) {
      if (i.kind !== "PRODUCT" || !i.productId) continue;
      const cur = need.get(i.productId);
      need.set(i.productId, { sku: i.sku, q: (cur?.q ?? dec(0)).add(dec(i.quantity)) });
    }
    const out: StockWarning[] = [];
    for (const [productId, { sku, q }] of need) {
      const b = await this.o.store.get("StockBalance", `${productId}:${warehouseId}`);
      const available = dec((b?.quantity as string | undefined) ?? 0);
      if (q.gt(available)) out.push({ productId, sku, requested: q.toString(), available: available.toString() });
    }
    return out;
  }

  /**
   * Convierte una cotización ACEPTADA: guarda la «venta pendiente» (partidas = instantánea de la cotización)
   * y encola `sale.convert`. Devuelve los avisos de existencia (el servidor decide).
   */
  async convertQuote(quoteId: string, warehouseId: string): Promise<{ sale: LocalSale; warnings: StockWarning[] }> {
    await this.require("sales.create", "No tienes permiso para convertir cotizaciones en venta.");
    await this.assertCapture();
    const { store } = this.o;
    const q = await store.get<LocalQuote>("Quote", quoteId);
    if (!q) throw new LocalRuleError("Cotización no encontrada.");
    if (q.status !== "ACCEPTED") throw new LocalRuleError("Solo se pueden convertir cotizaciones aceptadas.");
    const existing = await store.list<"Sale", LocalSale>("Sale", { where: { quoteId } });
    if (existing.some((s) => !isPendingSale(s))) throw new LocalRuleError("Esta cotización ya tiene una venta.");
    if (existing.some((s) => s._sync?.state !== "rejected")) throw new LocalRuleError("Esta cotización ya tiene una venta pendiente de sincronizar.");
    const w = await store.get("Warehouse", warehouseId);
    if (!w || w.active === false) throw new LocalRuleError("Almacén no disponible.");
    const user = await this.user();
    const warnings = await this.previewStock(q.items, warehouseId);
    const cmd = await this.enqueue("sale.convert", { quoteId, warehouseId });
    const sale: LocalSale = {
      id: pendingSaleId(quoteId), folio: null, quoteId, quoteFolio: q.folio, customerId: q.customerId, customerName: q.customerName,
      sellerId: q.sellerId ?? user.id, warehouseId, status: "PENDING_SYNC",
      subtotal: q.subtotal, discountTotal: q.discountTotal, taxTotal: q.taxTotal, total: q.total, confirmedAt: null,
      items: q.items.map(({ unitCost: _c, ...i }) => ({ ...i })),
      payments: [], quoteLabel: quoteFolioLabel(q), stockWarnings: warnings,
      _sync: { state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: false },
    };
    await store.put("Sale", [sale]);
    await this.changed();
    return { sale, warnings };
  }

  /** Registra un pago (outbox `payment.register`). Bloqueado en ventas pendientes; no puede exceder el saldo. */
  async registerPayment(saleId: string, input: PaymentInput): Promise<LocalPayment> {
    await this.require("payments.write", "No tienes permiso para registrar pagos.");
    await this.assertCapture();
    const s = await this.getSale(saleId);
    if (!s) throw new LocalRuleError("Venta no encontrada.");
    if (isPendingSale(s)) throw new LocalRuleError("La venta aún no está confirmada por el servidor. Sincroniza antes de registrar pagos.");
    if (s.status !== "CONFIRMED") throw new LocalRuleError("Solo se registran pagos en ventas confirmadas.");
    const amt = (input.amount ?? "").trim();
    if (!AMOUNT_RE.test(amt) || dec(amt).lte(0)) throw new LocalRuleError("Monto inválido.");
    const { balance } = saleBalance(s);
    if (dec(amt).gt(balance)) throw new LocalRuleError(`El monto excede el saldo (${balance.toFixed(2)}).`);
    const paidAt = clean(input.paidAt) ?? this.nowIso().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) throw new LocalRuleError("Fecha de pago inválida.");
    const reference = clean(input.reference);
    const id = this.uuid();
    const cmd = await this.enqueue("payment.register", { id, saleId: s.id, amount: dec(amt).toFixed(2), paidAt, method: input.method, ...(reference && { reference }) });
    const p: LocalPayment = {
      id, saleId: s.id, amount: dec(amt).toFixed(2), paidAt, method: input.method, reference, voidedAt: null, createdAt: cmd.capturedAt,
      _sync: { state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: false },
    };
    await this.o.store.put("Sale", [{ ...s, payments: [...(s.payments ?? []), p] }]);
    await this.changed();
    return p;
  }

  /** Descarta un pago local rechazado (o la venta pendiente rechazada si no se indica pago). */
  async dismissRejected(saleId: string, paymentId?: string): Promise<void> {
    const s = await this.getSale(saleId);
    if (!s) return;
    if (paymentId) {
      await this.o.store.put("Sale", [{ ...s, payments: (s.payments ?? []).filter((p) => !(p.id === paymentId && p._sync?.state === "rejected")) }]);
    } else if (isPendingSale(s) && s._sync?.state === "rejected") await this.o.store.delete("Sale", [s.id]);
    await this.changed();
  }

  balance(s: Pick<LocalSale, "total" | "payments">): SaleBalance { return saleBalance(s); }

  async getSale(id: string): Promise<LocalSale | null> { return this.o.store.get<LocalSale>("Sale", id); }

  /** Pendientes primero, luego por folio descendente. */
  async listSales(opts: { q?: string; status?: LocalSaleStatus; customerId?: string; limit?: number } = {}): Promise<LocalSale[]> {
    const { store } = this.o;
    const rows = opts.q?.trim()
      ? (await store.search<LocalSale>("Sale", opts.q, opts.limit ?? 50)).filter((r) => !opts.customerId || r.customerId === opts.customerId)
      : await store.list<"Sale", LocalSale>("Sale", { where: { ...(opts.customerId && { customerId: opts.customerId }) } });
    return rows
      .filter((r) => !opts.status || r.status === opts.status)
      .sort((a, b) => (b.folio ?? Number.MAX_SAFE_INTEGER) - (a.folio ?? Number.MAX_SAFE_INTEGER))
      .slice(0, opts.limit ?? 100);
  }
}
