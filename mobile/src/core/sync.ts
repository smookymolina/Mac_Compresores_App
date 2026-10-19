import { ResyncError, SYNC_ENTITIES, UnauthorizedError, UpgradeError, type ApiClient, type CommandState, type EntityRow, type PulledChange, type PushResult, type SyncEntity } from "./api";
import type { LocalQuote, QuoteSync } from "./quotes";
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

  private async applyResult(entry: OutboxEntry, r: PushResult | CommandState) {
    const p = entry.cmd.payload as { id?: string; quoteId?: string };
    if (!entry.cmd.type.startsWith("quote.")) return;
    const qid = entry.cmd.type === "quote.create" ? p.id : p.quoteId;
    if (!qid) return;
    const q = await this.o.store.get<LocalQuote>("Quote", qid);
    if (!q) return;
    const prev: QuoteSync = q._sync ?? { state: "applied", commandId: null, onServer: true };
    let next: QuoteSync;
    if (r.status === "APPLIED") {
      // Solo el último comando de la cotización la deja «aplicada».
      const onServer = prev.onServer || entry.cmd.type === "quote.create";
      next = prev.commandId === entry.cmd.id
        ? { ...prev, state: "applied", onServer, error: undefined, conflict: undefined }
        : { ...prev, onServer };
    } else if (r.status === "REJECTED") {
      next = { ...prev, state: "rejected", commandId: entry.cmd.id, commandType: entry.cmd.type, error: r.error ?? "Rechazado por el servidor.", conflict: undefined };
    } else {
      next = { ...prev, state: "conflict", commandId: entry.cmd.id, commandType: entry.cmd.type, conflict: r.result ?? null, ...(r.error && { error: r.error }) };
    }
    await this.o.store.put("Quote", [{ ...q, _sync: next }]);
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
    const rows = (await store.list<"Quote", LocalQuote>("Quote")).filter((q) => q._sync?.state === "conflict" && q._sync.commandId);
    if (!rows.length) return;
    const states = await api.commands(rows.map((q) => q._sync!.commandId!));
    const byCmd = new Map(states.map((s) => [s.id, s]));
    for (const q of rows) {
      const s = byCmd.get(q._sync!.commandId!);
      if (!s) continue;
      const fresh = await store.get<LocalQuote>("Quote", q.id);
      if (!fresh?._sync) continue;
      const sync: QuoteSync = s.status === "APPLIED"
        ? { ...fresh._sync, state: "applied", onServer: true, error: undefined, conflict: undefined }
        : s.status === "REJECTED"
          ? { ...fresh._sync, state: "rejected", error: s.error ?? "Rechazado por gerencia.", conflict: undefined }
          : { ...fresh._sync, conflict: s.result ?? fresh._sync.conflict };
      await store.put("Quote", [{ ...fresh, _sync: sync }]);
    }
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
    // Cotizaciones capturadas en el teléfono que el servidor aún no confirma: sobreviven al re-bootstrap.
    const local = (await store.list<"Quote", LocalQuote>("Quote")).filter((q) => q._sync && q._sync.state !== "applied");
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
        await store.put(entity, entity === "Quote" ? await mergeQuotes(store, page.items) : page.items);
        loaded += page.items.length;
        this.o.onProgress?.({ entity, loaded });
        after = page.next ?? undefined;
      } while (after);
    }
    for (const q of local) {
      const server = await store.get("Quote", q.id);
      await store.put("Quote", [server ? mergeQuote(server, q) : q]);
    }
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
  for (const [e, list] of puts) {
    const rows = list.map((c) => ({ ...c.data!, id: c.id }));
    await store.put(e, e === "Quote" ? await mergeQuotes(store, rows) : rows);
  }
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

async function mergeQuotes(store: LocalStore, rows: EntityRow[]): Promise<EntityRow[]> {
  const out: EntityRow[] = [];
  for (const r of rows) out.push(mergeQuote(r, await store.get<LocalQuote>("Quote", r.id)));
  return out;
}
