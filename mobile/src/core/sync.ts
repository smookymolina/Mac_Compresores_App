import { dec } from "@domain/money";
import { ResyncError, SYNC_ENTITIES, UnauthorizedError, UpgradeError, type ApiClient, type CommandState, type EntityRow, type PulledChange, type PushResult, type SaleConvertResult, type SyncCommand, type SyncEntity } from "./api";
import type { LocalCustomer } from "./customers";
import { balanceId, getMovements, recomputeBalance, saveMovements, withPending, type LocalMovement } from "./inventory";
import type { EntitySync } from "./local";
import { quoteFolioLabel, type LocalQuote, type QuoteSync } from "./quotes";
import { isPendingSale, pendingSaleId, saleFolioLabel, type LocalPayment, type LocalSale } from "./sales";
import type { LocalStore, OutboxEntry } from "./store";

/** Mínimo de folios apartados sin usar; por debajo se piden `FOLIO_BLOCK` más. */
export const FOLIO_MIN = 5;
export const FOLIO_BLOCK = 25;
export const PUSH_BATCH = 100;

export interface SyncEngineOptions {
  /** `push`/`commands`/`folios`/`config` son opcionales (si faltan, se omite ese paso). */
  api: Pick<ApiClient, "bootstrap" | "pull"> & Partial<Pick<ApiClient, "push" | "commands" | "folios" | "config">>;
  store: LocalStore;
  /** Dispositivo revocado (401): se llama DESPUÉS de borrar los datos locales (para limpiar sesión/token). */
  onUnauthorized?: () => Promise<void> | void;
  /** Progreso de la descarga inicial. */
  onProgress?: (p: { entity: SyncEntity; loaded: number }) => void;
  bootstrapPageSize?: number;
  pullPageSize?: number;
  now?: () => Date;
}

export interface PushSummary { sent: number; applied: number; rejected: number; conflicts: number; stopped: boolean }
export interface SyncResult { bootstrapped: boolean; changes: number; cursor: string; push?: PushSummary }

/**
 * Motor de sincronización.
 * 1. Push del outbox (≤100, en orden) ANTES del pull: APPLIED/REJECTED/CONFLICT actualizan `_sync` de la cotización;
 *    "retry" detiene el envío (se conserva el orden); sin red → error.
 * 2. Pull (o bootstrap sin cursor / 410 RESYNC: borra entidades salvo cotizaciones locales sin aplicar; no el outbox).
 *    Una Quote del servidor reemplaza a la local con el mismo id (ver `mergeQuote`).
 * 3. Mejor esfuerzo: estado de conflictos (`/commands`), `/config` y reserva de folios (≥5 sin usar).
 * - 401 → wipe total + `onUnauthorized`.
 */
export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  constructor(private o: SyncEngineOptions) {}

  /** Espera a que termine la sincronización en curso (si hay); nunca lanza. */
  async idle(): Promise<void> {
    if (this.running) await this.running.catch(() => undefined);
  }

  /** Una sincronización a la vez: llamadas concurrentes comparten la misma promesa. */
  sync(): Promise<SyncResult> {
    this.running ??= this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private async run(): Promise<SyncResult> {
    try {
      return await this.guarded();
    } catch (e) {
      if (e instanceof UnauthorizedError) {
        await this.o.store.wipe();
        await this.o.onUnauthorized?.();
      }
      throw e;
    }
  }

  private async guarded(): Promise<SyncResult> {
    const cursor = await this.o.store.getMeta("cursor");
    const push = cursor === null ? undefined : await this.push();
    let r: SyncResult;
    try {
      r = cursor === null ? await this.bootstrap() : { bootstrapped: false, ...(await this.pull()) };
    } catch (e) {
      if (!(e instanceof ResyncError)) throw e;
      // Un segundo 410 durante el re-bootstrap se propaga (sin bucle).
      r = await this.bootstrap();
    }
    await this.afterPull();
    return { ...r, ...(push && { push }) };
  }

  /** Envía el outbox en orden y aplica cada resultado. */
  async push(): Promise<PushSummary> {
    const { api, store } = this.o;
    const sum: PushSummary = { sent: 0, applied: 0, rejected: 0, conflicts: 0, stopped: false };
    if (!api.push) return sum;
    const batch = await store.outbox(PUSH_BATCH);
    if (!batch.length) return sum;
    sum.sent = batch.length;
    const res = await api.push(batch.map((e) => e.cmd));
    const byId = new Map((res.results ?? []).map((r) => [r.id, r]));
    for (const entry of batch) {
      const r = byId.get(entry.cmd.id);
      if (!r || r.status === "retry") {
        // Se detiene aquí: los siguientes dependen del orden.
        await store.updateOutbox(entry.cmd.id, { attempts: entry.attempts + 1, lastError: r?.error ?? "Sin respuesta del servidor." });
        sum.stopped = true;
        break;
      }
      await this.applyResult(entry, r);
      await store.removeOutbox([entry.cmd.id]);
      if (r.status === "APPLIED") sum.applied++;
      else if (r.status === "REJECTED") sum.rejected++;
      else sum.conflicts++;
    }
    return sum;
  }

  /** Aplica el resultado de un comando a su entidad local (`_sync`, reversa optimista, venta confirmada…). */
  private async applyResult(entry: OutboxEntry, r: PushResult | CommandState) {
    const { store } = this.o;
    const cmd = entry.cmd;
    const p = cmd.payload as Record<string, string | undefined>;
    const ok = r.status === "APPLIED";
    switch (cmd.type) {
      case "quote.create": case "quote.update": case "quote.status": case "quote.email": {
        const q = await store.get<LocalQuote>("Quote", (cmd.type === "quote.create" ? p.id : p.quoteId) ?? "");
        if (q) await store.put("Quote", [{ ...q, _sync: nextSync(q._sync, cmd, r) }]);
        return;
      }
      case "customer.save": case "customer.contact.add": case "customer.contact.remove": case "customer.address.add": case "customer.address.remove": {
        const c = await store.get<LocalCustomer>("Customer", (cmd.type === "customer.save" ? p.id : p.customerId) ?? "");
        if (!c) return;
        const row: LocalCustomer = { ...c, _sync: nextSync(c._sync, cmd, r) };
        // Alta de contacto/dirección: aplicada → sin marca; rechazada/conflicto → se retira de la vista local.
        const fix = <T extends { id: string; _sync?: EntitySync }>(list: T[] = []) =>
          ok ? list.map(({ _sync: _s, ...x }) => (x.id === p.id ? x : { ...x, ...(_s && { _sync: _s }) }) as T) : list.filter((x) => x.id !== p.id);
        if (cmd.type === "customer.contact.add") row.contacts = fix(c.contacts);
        if (cmd.type === "customer.address.add") row.addresses = fix(c.addresses);
        await store.put("Customer", [row]);
        return;
      }
      case "sale.convert": {
        const sale = await store.get<LocalSale>("Sale", pendingSaleId(p.quoteId ?? ""));
        if (!sale) return;
        const res = ok ? (r.result as SaleConvertResult | undefined) : undefined;
        await store.put("Sale", [{ ...sale, _sync: nextSync(sale._sync, cmd, r), ...(res?.saleId && { serverSaleId: res.saleId, folio: res.folio ?? sale.folio }) }]);
        return;
      }
      case "payment.register": {
        const sale = await store.get<LocalSale>("Sale", p.saleId ?? "");
        if (!sale) return;
        const payments = (sale.payments ?? []).map((x) => (x.id === p.id && x._sync ? { ...x, _sync: nextSync(x._sync, cmd, r) } : x));
        await store.put("Sale", [{ ...sale, payments }]);
        return;
      }
      case "inventory.movement": {
        const list = await getMovements(store);
        const m = list.find((x) => x.id === p.id);
        if (!m) return;
        m._sync = nextSync(m._sync, cmd, r);
        await saveMovements(store, list);
        // Aplicado: ya es parte de la existencia del servidor; rechazado/conflicto: se revierte (deja de sumarse).
        await recomputeBalance(store, m.productId, m.warehouseId, ok ? dec(m.delta) : undefined);
        return;
      }
    }
  }

  /** Pasos de mejor esfuerzo tras el pull: no hacen fallar la sincronización (salvo 401/409 upgrade). */
  private async afterPull() {
    for (const step of [() => this.pollConflicts(), () => this.fetchConfig(), () => this.topUpFolios()]) {
      try { await step(); } catch (e) {
        if (e instanceof UnauthorizedError || e instanceof UpgradeError) throw e;
      }
    }
  }

  /** Consulta los comandos en conflicto (gerencia pudo resolverlos) y actualiza su estado. */
  async pollConflicts() {
    const { api, store } = this.o;
    if (!api.commands) return;
    const handlers = new Map<string, (s: CommandState) => Promise<void>>();
    const isConflict = (x?: EntitySync) => x?.state === "conflict" && !!x.commandId;
    for (const entity of ["Quote", "Customer"] as const) {
      for (const row of await store.list<typeof entity, EntityRow & { _sync?: EntitySync }>(entity)) {
        if (!isConflict(row._sync)) continue;
        handlers.set(row._sync!.commandId!, async (s) => {
          const fresh = await store.get<EntityRow & { _sync?: EntitySync }>(entity, row.id);
          if (fresh?._sync) await store.put(entity, [{ ...fresh, _sync: resolvedSync(fresh._sync, s) }]);
        });
      }
    }
    for (const sale of await store.list<"Sale", LocalSale>("Sale")) {
      if (isConflict(sale._sync)) handlers.set(sale._sync!.commandId!, async (s) => {
        const fresh = await store.get<LocalSale>("Sale", sale.id);
        if (!fresh?._sync) return;
        const res = s.status === "APPLIED" ? (s.result as SaleConvertResult | undefined) : undefined;
        await store.put("Sale", [{ ...fresh, _sync: resolvedSync(fresh._sync, s), ...(res?.saleId && { serverSaleId: res.saleId, folio: res.folio ?? fresh.folio }) }]);
      });
      for (const pay of sale.payments ?? []) {
        if (isConflict(pay._sync)) handlers.set(pay._sync!.commandId!, async (s) => {
          const fresh = await store.get<LocalSale>("Sale", sale.id);
          if (!fresh) return;
          await store.put("Sale", [{ ...fresh, payments: (fresh.payments ?? []).map((x) => (x.id === pay.id && x._sync ? { ...x, _sync: resolvedSync(x._sync, s) } : x)) }]);
        });
      }
    }
    for (const m of await getMovements(store)) {
      // Al aplicarse más tarde, la existencia real llega en el siguiente pull.
      if (isConflict(m._sync)) handlers.set(m._sync.commandId!, async (s) => {
        const list = await getMovements(store);
        const x = list.find((y) => y.id === m.id);
        if (x) { x._sync = resolvedSync(x._sync, s); await saveMovements(store, list); }
      });
    }
    if (!handlers.size) return;
    const states = await api.commands([...handlers.keys()]);
    for (const s of states) await handlers.get(s.id)?.(s);
  }

  async fetchConfig() {
    if (!this.o.api.config) return;
    await this.o.store.setMeta("config", await this.o.api.config());
  }

  /** Mantiene ≥ FOLIO_MIN folios apartados sin usar (pide FOLIO_BLOCK). */
  async topUpFolios() {
    const { api, store } = this.o;
    if (!api.folios) return;
    const have = (await store.getMeta("folios")) ?? [];
    if (have.length >= FOLIO_MIN) return;
    const res = await api.folios(FOLIO_BLOCK);
    // El servidor devuelve los folios sin usar del dispositivo; se descartan los que ya usa una cotización local.
    const used = new Set((await store.list<"Quote", LocalQuote>("Quote")).map((q) => q.folio).filter((f): f is number => typeof f === "number"));
    const all = [...new Set([...have, ...(res.folios ?? [])])].filter((f) => !used.has(f)).sort((a, b) => a - b);
    await store.setMeta("folios", all);
  }

  /** Descarga inicial: borra entidades, baja todo paginado y luego aplica pull desde serverSeq. */
  async bootstrap(): Promise<SyncResult> {
    const { api, store } = this.o;
    // Capturas del teléfono que el servidor aún no confirma: sobreviven al re-bootstrap.
    const local = await unconfirmedRows(store);
    await store.clear();
    await store.deleteMeta("cursor");
    let serverSeq: string | null = null;
    for (const entity of SYNC_ENTITIES) {
      let after: string | undefined;
      let loaded = 0;
      do {
        const page = await api.bootstrap(entity, after, this.o.bootstrapPageSize);
        // El primer serverSeq (capturado antes de leer nada) es el menor: lo que cambie después llega por pull.
        if (serverSeq === null && page.serverSeq !== undefined) serverSeq = String(page.serverSeq);
        await putMerged(store, entity, page.items);
        loaded += page.items.length;
        this.o.onProgress?.({ entity, loaded });
        after = page.next ?? undefined;
      } while (after);
    }
    for (const [entity, row] of local) {
      if (entity === "Sale" && isPendingSale(row as LocalSale)) {
        // Venta pendiente: si el servidor ya tiene la venta de esa cotización, se descarta.
        if ((await store.list("Sale", { where: { quoteId: String(row.quoteId) } })).length) continue;
        await store.put("Sale", [row]);
        continue;
      }
      const server = await store.get(entity, row.id);
      await store.put(entity, [server ? mergeRow(entity, server, row) : row]);
    }
    const keys = new Map((await getMovements(store)).filter((m) => m._sync.state === "pending").map((m) => [balanceId(m.productId, m.warehouseId), m]));
    for (const m of keys.values()) await recomputeBalance(store, m.productId, m.warehouseId);
    const seq = serverSeq ?? "0";
    await store.setMeta("serverSeq", seq);
    await store.setMeta("cursor", seq);
    const r = await this.pull();
    return { bootstrapped: true, ...r };
  }

  /** Pull hasta `hasMore = false`. Guarda el cursor tras aplicar cada página. */
  async pull(): Promise<{ changes: number; cursor: string }> {
    const { api, store } = this.o;
    let cursor = (await store.getMeta("cursor")) ?? "0";
    let changes = 0;
    for (;;) {
      const res = await api.pull(cursor, this.o.pullPageSize);
      await applyChanges(store, res.changes);
      changes += res.changes.length;
      cursor = String(res.cursor);
      await store.setMeta("cursor", cursor);
      if (!res.hasMore) break;
    }
    await store.setMeta("lastSyncAt", (this.o.now?.() ?? new Date()).toISOString());
    return { changes, cursor };
  }
}

/** Aplica cambios en orden: bajas → delete, altas/cambios → upsert (agrupado por entidad). */
export async function applyChanges(store: LocalStore, changes: PulledChange[]) {
  const puts = new Map<SyncEntity, PulledChange[]>();
  const dels = new Map<SyncEntity, string[]>();
  for (const c of changes) {
    if (c.deleted || !c.data) dels.set(c.entity, [...(dels.get(c.entity) ?? []), c.id]);
    else puts.set(c.entity, [...(puts.get(c.entity) ?? []), c]);
  }
  // El servidor ya deduplica por entidad+id dentro de una página, así que el orden entre grupos no importa.
  for (const [e, ids] of dels) await store.delete(e, ids);
  for (const [e, list] of puts) await putMerged(store, e, list.map((c) => ({ ...c.data!, id: c.id })));
}

/**
 * Quote del servidor vs. local con el mismo id:
 * - local `pending` (comando aún sin enviar) → se conserva la local (solo se actualiza `baseUpdatedAt`);
 * - local `conflict`/`rejected` → datos del servidor, se conserva `_sync` (sigue visible y se consulta);
 * - si no → datos del servidor con `_sync` aplicado.
 */
export function mergeQuote(server: EntityRow, local: LocalQuote | null): EntityRow {
  const base = typeof server.updatedAt === "string" ? server.updatedAt : server.updatedAt ? String(server.updatedAt) : undefined;
  const ls = local?._sync;
  if (local && ls?.state === "pending") return { ...local, _sync: { ...ls, onServer: true, ...(base && { baseUpdatedAt: base }) } };
  const sync: QuoteSync = ls && (ls.state === "conflict" || ls.state === "rejected")
    ? { ...ls, onServer: true, ...(base && { baseUpdatedAt: base }) }
    : { state: "applied", commandId: ls?.commandId ?? null, onServer: true, ...(base && { baseUpdatedAt: base }) };
  return { ...server, _sync: sync };
}

/** Venta del servidor + pagos capturados en el teléfono que aún no llegan (pendientes/rechazados/en conflicto). */
export function mergeSale(server: EntityRow, local: LocalSale | null): EntityRow {
  const have = new Set(((server.payments as LocalPayment[] | undefined) ?? []).map((x) => x.id));
  const keep = (local?.payments ?? []).filter((x) => x._sync && x._sync.state !== "applied" && !have.has(x.id));
  return keep.length ? { ...server, payments: [...((server.payments as LocalPayment[] | undefined) ?? []), ...keep] } : server;
}

/** Fila del servidor combinada con la local (mismo id). */
export function mergeRow(entity: SyncEntity, server: EntityRow, local: EntityRow | null, movements: LocalMovement[] = []): EntityRow {
  if (entity === "Quote" || entity === "Customer") return mergeQuote(server, local as LocalQuote | null);
  if (entity === "Sale") return mergeSale(server, local as LocalSale | null);
  if (entity === "StockBalance") return withPending(server, movements);
  return server;
}

/** Upsert de filas del servidor respetando capturas locales; una Sale del servidor reemplaza la venta pendiente de su cotización. */
async function putMerged(store: LocalStore, entity: SyncEntity, rows: EntityRow[]) {
  if (!["Quote", "Customer", "Sale", "StockBalance"].includes(entity)) return store.put(entity, rows);
  const movements = entity === "StockBalance" ? await getMovements(store) : [];
  const out: EntityRow[] = [];
  for (const r of rows) out.push(mergeRow(entity, r, await store.get(entity, r.id), movements));
  await store.put(entity, out);
  if (entity === "Sale") {
    const pend = rows.filter((r) => typeof r.quoteId === "string").map((r) => pendingSaleId(r.quoteId as string)).filter((id) => !rows.some((r) => r.id === id));
    if (pend.length) await store.delete("Sale", pend);
  }
}

/** Filas con capturas sin confirmar (para conservarlas en un re-bootstrap). */
async function unconfirmedRows(store: LocalStore): Promise<[SyncEntity, EntityRow][]> {
  const out: [SyncEntity, EntityRow][] = [];
  for (const e of ["Quote", "Customer"] as const) {
    for (const r of await store.list<typeof e, EntityRow & { _sync?: EntitySync }>(e)) if (r._sync && r._sync.state !== "applied") out.push([e, r]);
  }
  for (const s of await store.list<"Sale", LocalSale>("Sale")) {
    if (isPendingSale(s) || (s.payments ?? []).some((x) => x._sync && x._sync.state !== "applied")) out.push(["Sale", s]);
  }
  return out;
}

/** `_sync` tras el resultado de un comando en el push. Solo el último comando de la entidad la deja «aplicada». */
export function nextSync(prev: EntitySync | undefined, cmd: SyncCommand, r: PushResult | CommandState): EntitySync {
  const p: EntitySync = prev ?? { state: "applied", commandId: null, onServer: true };
  if (r.status === "APPLIED") {
    const onServer = p.onServer || cmd.type === "quote.create" || cmd.type === "customer.save" || cmd.type === "sale.convert" || cmd.type === "payment.register" || cmd.type === "inventory.movement";
    return p.commandId === cmd.id ? { ...p, state: "applied", onServer, error: undefined, conflict: undefined } : { ...p, onServer };
  }
  if (r.status === "REJECTED") return { ...p, state: "rejected", commandId: cmd.id, commandType: cmd.type, error: r.error ?? "Rechazado por el servidor.", conflict: undefined };
  return { ...p, state: "conflict", commandId: cmd.id, commandType: cmd.type, conflict: r.result ?? null, ...(r.error && { error: r.error }) };
}

/** `_sync` tras consultar un comando en conflicto (`/api/sync/commands`). */
export function resolvedSync(prev: EntitySync, s: CommandState): EntitySync {
  if (s.status === "APPLIED") return { ...prev, state: "applied", onServer: true, error: undefined, conflict: undefined };
  if (s.status === "REJECTED") return { ...prev, state: "rejected", error: s.error ?? "Rechazado por gerencia.", conflict: undefined };
  return { ...prev, conflict: s.result ?? prev.conflict };
}

export type SyncIssueEntity = "Quote" | "Customer" | "Sale" | "Payment" | "InventoryMovement";
/** Captura con conflicto o rechazo pendiente de revisar (cualquier entidad). */
export interface SyncIssue { entity: SyncIssueEntity; id: string; /** Venta del pago. */ parentId?: string; label: string; sync: EntitySync }

/** Conflictos y rechazos de todas las capturas locales. */
export async function listSyncIssues(store: LocalStore): Promise<SyncIssue[]> {
  const bad = (x?: EntitySync): x is EntitySync => x?.state === "conflict" || x?.state === "rejected";
  const out: SyncIssue[] = [];
  for (const q of await store.list<"Quote", LocalQuote>("Quote", { orderBy: "updatedAt", desc: true })) if (bad(q._sync)) out.push({ entity: "Quote", id: q.id, label: quoteFolioLabel(q), sync: q._sync });
  for (const c of await store.list<"Customer", LocalCustomer>("Customer")) if (bad(c._sync)) out.push({ entity: "Customer", id: c.id, label: c.legalName, sync: c._sync });
  for (const s of await store.list<"Sale", LocalSale>("Sale")) {
    if (bad(s._sync)) out.push({ entity: "Sale", id: s.id, label: saleFolioLabel(s), sync: s._sync });
    for (const x of s.payments ?? []) if (bad(x._sync)) out.push({ entity: "Payment", id: x.id, parentId: s.id, label: `Pago ${x.amount} · ${saleFolioLabel(s)}`, sync: x._sync });
  }
  for (const m of await getMovements(store)) if (bad(m._sync)) out.push({ entity: "InventoryMovement", id: m.id, label: `${m.type} ${m.quantity} · ${m.sku}`, sync: m._sync });
  return out;
}

