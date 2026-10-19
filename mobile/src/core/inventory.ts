import { dec, type Dec } from "@domain/money";
import type { EntityRow } from "./api";
import { LocalRuleError, LocalService, type EntitySync } from "./local";
import type { LocalStore } from "./store";

// ---------- Tipos ----------

export type MovementType = "IN" | "OUT" | "ADJUST";

/** Movimiento capturado en el teléfono (se guarda en meta `movements`). */
export interface LocalMovement {
  id: string;
  productId: string;
  warehouseId: string;
  type: MovementType;
  /** Cantidad capturada (OUT positiva; ADJUST con signo). */
  quantity: string;
  /** Efecto en la existencia (+/−). */
  delta: string;
  reason: string;
  sku: string;
  capturedAt: string;
  _sync: EntitySync;
}

/** Fila StockBalance (`id = productId:warehouseId`). `_serverQuantity` = última existencia del servidor. */
export interface LocalStockBalance extends EntityRow {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: string;
  minStock?: string;
  updatedAt?: string;
  _serverQuantity?: string;
  /** Hay movimientos locales sin confirmar sumados en `quantity`. */
  _pending?: boolean;
}
export type BalanceView = LocalStockBalance & { sku: string; description: string; unit: string };

/** Movimientos aplicados que se conservan como historial local. */
export const KEEP_APPLIED_MOVEMENTS = 50;
const QTY_RE = /^-?\d+(\.\d{1,3})?$/;

export const balanceId = (productId: string, warehouseId: string) => `${productId}:${warehouseId}`;

/** Mismo signo que `registerMovement` del servidor: OUT resta |q|, IN suma, ADJUST con signo. */
export function movementDelta(type: MovementType, quantity: string): Dec {
  const q = dec(quantity);
  return type === "OUT" ? q.abs().neg() : q;
}

export async function getMovements(store: LocalStore): Promise<LocalMovement[]> {
  return (await store.getMeta("movements")) ?? [];
}
export async function saveMovements(store: LocalStore, list: LocalMovement[]) {
  const applied = list.filter((m) => m._sync.state === "applied");
  const drop = new Set(applied.slice(0, Math.max(0, applied.length - KEEP_APPLIED_MOVEMENTS)).map((m) => m.id));
  await store.setMeta("movements", list.filter((m) => !drop.has(m.id)));
}

/** Existencia local = existencia del servidor + movimientos locales aún pendientes. */
export function withPending(server: EntityRow, movements: LocalMovement[]): LocalStockBalance {
  const base = dec((server.quantity as string | undefined) ?? 0);
  const pend = movements.filter((m) => m._sync.state === "pending" && balanceId(m.productId, m.warehouseId) === server.id);
  const q = pend.reduce((a, m) => a.add(dec(m.delta)), base);
  const { _pending: _p, _serverQuantity: _s, ...rest } = server as LocalStockBalance;
  return { ...rest, quantity: q.toString(), _serverQuantity: base.toString(), ...(pend.length && { _pending: true }) } as LocalStockBalance;
}

/** Recalcula la existencia local de una clave (tras aplicar/rechazar un movimiento). */
export async function recomputeBalance(store: LocalStore, productId: string, warehouseId: string, serverDelta?: Dec) {
  const id = balanceId(productId, warehouseId);
  const cur = await store.get<LocalStockBalance>("StockBalance", id);
  const server = dec(cur?._serverQuantity ?? cur?.quantity ?? 0).add(serverDelta ?? 0);
  const row = withPending({ ...(cur ?? { id, productId, warehouseId }), quantity: server.toString() }, await getMovements(store));
  await store.put("StockBalance", [row]);
}

// ---------- Servicio ----------

/** Inventario local: existencias por almacén y movimientos (requiere `inventory.write` para capturar). */
export class InventoryService extends LocalService {
  /**
   * Registra un movimiento: actualiza la existencia local al instante (marcada pendiente) y encola `inventory.movement`.
   * Si la existencia local quedaría negativa se devuelve `warning` (el servidor decide).
   */
  async registerMovement(input: { productId: string; warehouseId: string; type: MovementType; quantity: string; reason: string }): Promise<{ movement: LocalMovement; balance: LocalStockBalance; warning: string | null }> {
    await this.require("inventory.write", "No tienes permiso para registrar movimientos de inventario.");
    await this.assertCapture();
    const { store } = this.o;
    const p = await store.get("Product", input.productId);
    if (!p) throw new LocalRuleError("Producto no encontrado.");
    const w = await store.get("Warehouse", input.warehouseId);
    if (!w || w.active === false) throw new LocalRuleError("Almacén no disponible.");
    const qs = (input.quantity ?? "").trim();
    if (!QTY_RE.test(qs)) throw new LocalRuleError("Cantidad inválida (máx. 3 decimales).");
    const q = dec(qs);
    if (q.isZero() || (input.type !== "ADJUST" && q.lt(0))) throw new LocalRuleError(input.type === "ADJUST" ? "El ajuste no puede ser cero." : "La cantidad debe ser positiva.");
    const reason = (input.reason ?? "").trim();
    if (reason.length < 3) throw new LocalRuleError("Indica el motivo del movimiento.");
    const delta = movementDelta(input.type, qs);
    const cmd = await this.enqueue("inventory.movement", { id: this.uuid(), productId: p.id, warehouseId: w.id, type: input.type, quantity: q.toString(), reason });
    const movement: LocalMovement = {
      id: cmd.payload.id as string, productId: p.id, warehouseId: w.id, type: input.type, quantity: q.toString(), delta: delta.toString(), reason,
      sku: String(p.sku ?? ""), capturedAt: cmd.capturedAt, _sync: { state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: false },
    };
    await saveMovements(store, [...(await getMovements(store)), movement]);
    await recomputeBalance(store, p.id, w.id);
    const balance = (await store.get<LocalStockBalance>("StockBalance", balanceId(p.id, w.id)))!;
    await this.changed();
    return { movement, balance, warning: dec(balance.quantity).lt(0) ? `La existencia local quedaría en ${balance.quantity}.` : null };
  }

  /** Existencias (con datos del producto); `q` busca por SKU/núm. de parte/descripción. */
  async listBalances(opts: { warehouseId?: string; q?: string; limit?: number } = {}): Promise<BalanceView[]> {
    const { store } = this.o;
    let rows = await store.list<"StockBalance", LocalStockBalance>("StockBalance", { where: { ...(opts.warehouseId && { warehouseId: opts.warehouseId }) } });
    if (opts.q?.trim()) {
      const ids = new Set((await store.search("Product", opts.q, 500)).map((p) => p.id));
      rows = rows.filter((r) => ids.has(r.productId));
    }
    const out: BalanceView[] = [];
    for (const r of rows.slice(0, opts.limit ?? 200)) {
      const p = await store.get("Product", r.productId);
      out.push({ ...r, sku: String(p?.sku ?? ""), description: String(p?.description ?? ""), unit: String(p?.unit ?? "") });
    }
    return out.sort((a, b) => a.sku.localeCompare(b.sku));
  }

  /** Movimientos capturados en el teléfono (más recientes primero); `state` filtra (p. ej. "pending"). */
  async listMovements(opts: { state?: EntitySync["state"]; warehouseId?: string } = {}): Promise<LocalMovement[]> {
    return (await getMovements(this.o.store))
      .filter((m) => (!opts.state || m._sync.state === opts.state) && (!opts.warehouseId || m.warehouseId === opts.warehouseId))
      .reverse();
  }
}
