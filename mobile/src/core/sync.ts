import { ResyncError, SYNC_ENTITIES, UnauthorizedError, type ApiClient, type PulledChange, type SyncEntity } from "./api";
import type { LocalStore } from "./store";

export interface SyncEngineOptions {
  api: Pick<ApiClient, "bootstrap" | "pull">;
  store: LocalStore;
  /** Dispositivo revocado (401): se llama DESPUÉS de borrar los datos locales (para limpiar sesión/token). */
  onUnauthorized?: () => Promise<void> | void;
  /** Progreso de la descarga inicial. */
  onProgress?: (p: { entity: SyncEntity; loaded: number }) => void;
  bootstrapPageSize?: number;
  pullPageSize?: number;
  now?: () => Date;
}

export interface SyncResult { bootstrapped: boolean; changes: number; cursor: string }

/**
 * Motor de sincronización (fase 2: solo bajada).
 * - Sin cursor → bootstrap de todas las entidades y luego pull desde el serverSeq capturado.
 * - 410 RESYNC → borra entidades (no el outbox) y vuelve a hacer bootstrap.
 * - 401 → wipe total + `onUnauthorized`.
 * TODO(fase 3): push del outbox antes del pull.
 */
export class SyncEngine {
  private running: Promise<SyncResult> | null = null;
  constructor(private o: SyncEngineOptions) {}

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
    try {
      if (cursor === null) return await this.bootstrap();
      const r = await this.pull();
      return { bootstrapped: false, ...r };
    } catch (e) {
      if (!(e instanceof ResyncError)) throw e;
      // Un segundo 410 durante el re-bootstrap se propaga (sin bucle).
      return await this.bootstrap();
    }
  }

  /** Descarga inicial: borra entidades, baja todo paginado y luego aplica pull desde serverSeq. */
  async bootstrap(): Promise<SyncResult> {
    const { api, store } = this.o;
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
        await store.put(entity, page.items);
        loaded += page.items.length;
        this.o.onProgress?.({ entity, loaded });
        after = page.next ?? undefined;
      } while (after);
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
  for (const [e, list] of puts) await store.put(e, list.map((c) => ({ ...c.data!, id: c.id })));
}
