import { Capacitor } from "@capacitor/core";
import { SYNC_ENTITIES, type EntityRow, type SyncCommand, type SyncEntity } from "./api";

/**
 * Copia local de lo que el usuario puede ver + metadatos (kv) + outbox.
 * Implementaciones: `SqliteStore` (teléfono, SQLCipher) y `MemoryStore` (pruebas / navegador).
 */

/** Columnas indexadas (filtro/orden) por entidad. Se guardan como texto. */
export const ENTITY_INDEX = {
  Product: ["sku", "oemPartNumber", "status", "line", "kind", "categoryId"],
  Customer: ["legalName", "rfc", "ownerId", "active"],
  Quote: ["folio", "customerId", "sellerId", "status", "updatedAt"],
  Sale: ["folio", "quoteId", "customerId", "sellerId", "status"],
  StockBalance: ["productId", "warehouseId"],
  Warehouse: ["code", "active"],
  ExchangeRate: ["createdAt"],
  ComplementPackage: ["code", "position"],
} as const satisfies Record<SyncEntity, readonly string[]>;

export type IndexedColumn<E extends SyncEntity> = (typeof ENTITY_INDEX)[E][number];

/** Campos de texto para `search()`. Product usa FTS5 en SQLite con estos mismos campos. */
export const ENTITY_SEARCH: Record<SyncEntity, readonly string[]> = {
  Product: ["sku", "oemPartNumber", "description", "searchText"],
  Customer: ["legalName", "rfc", "email", "phone"],
  Quote: ["folio", "customerName", "sellerName"],
  Sale: ["folio", "customerName", "quoteFolio"],
  StockBalance: [],
  Warehouse: ["code", "name"],
  ExchangeRate: [],
  ComplementPackage: ["code", "name"],
};

export interface ListOptions<E extends SyncEntity = SyncEntity> {
  /** Igualdad exacta sobre columnas indexadas (valores comparados como texto). */
  where?: Partial<Record<IndexedColumn<E>, string | number | boolean | null>>;
  orderBy?: IndexedColumn<E> | "id";
  desc?: boolean;
  limit?: number;
  offset?: number;
}

/** Claves kv conocidas. */
export interface MetaMap {
  /** Cursor de pull (SyncChange.seq como string). */
  cursor: string;
  /** serverSeq capturado al iniciar el último bootstrap. */
  serverSeq: string;
  /** ISO de la última sincronización completa con éxito. */
  lastSyncAt: string;
  user: import("./api").SessionUser;
  deviceId: string;
}
export type MetaKey = keyof MetaMap;

export interface OutboxEntry { cmd: SyncCommand; queuedAt: string; attempts: number; lastError?: string }

export interface LocalStore {
  init(): Promise<void>;
  /** Inserta o reemplaza (upsert) por `id`. */
  put(entity: SyncEntity, rows: EntityRow[]): Promise<void>;
  delete(entity: SyncEntity, ids: string[]): Promise<void>;
  get<T extends EntityRow = EntityRow>(entity: SyncEntity, id: string): Promise<T | null>;
  list<E extends SyncEntity, T extends EntityRow = EntityRow>(entity: E, opts?: ListOptions<E>): Promise<T[]>;
  count(entity: SyncEntity, opts?: Pick<ListOptions, "where">): Promise<number>;
  /** Búsqueda por palabras (prefijo, sin acentos, todas deben coincidir). */
  search<T extends EntityRow = EntityRow>(entity: SyncEntity, q: string, limit?: number): Promise<T[]>;
  /** Borra los datos de una entidad (o de todas). No toca meta ni outbox. */
  clear(entity?: SyncEntity): Promise<void>;
  getMeta<K extends MetaKey>(key: K): Promise<MetaMap[K] | null>;
  setMeta<K extends MetaKey>(key: K, value: MetaMap[K]): Promise<void>;
  deleteMeta(key: MetaKey): Promise<void>;
  // Outbox (fase 3): comandos pendientes en orden de captura.
  enqueue(cmd: SyncCommand): Promise<void>;
  outbox(limit?: number): Promise<OutboxEntry[]>;
  updateOutbox(id: string, patch: Partial<Pick<OutboxEntry, "attempts" | "lastError">>): Promise<void>;
  removeOutbox(ids: string[]): Promise<void>;
  pendingCount(): Promise<number>;
  /** Borra TODO: entidades, meta y outbox (dispositivo revocado / PIN bloqueado / logout). */
  wipe(): Promise<void>;
}

// ---------- utilidades compartidas ----------

export const normalize = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export const tokenize = (q: string) => normalize(q).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
export const colValue = (v: unknown): string | null => (v === null || v === undefined ? null : typeof v === "object" ? JSON.stringify(v) : String(v));
export const searchBlob = (entity: SyncEntity, row: Record<string, unknown>) =>
  normalize(ENTITY_SEARCH[entity].map((f) => colValue(row[f]) ?? "").join(" "));

// ---------- MemoryStore ----------

export class MemoryStore implements LocalStore {
  private data = new Map<SyncEntity, Map<string, EntityRow>>();
  private meta = new Map<string, unknown>();
  private queue: OutboxEntry[] = [];

  async init() {
    for (const e of SYNC_ENTITIES) if (!this.data.has(e)) this.data.set(e, new Map());
  }
  private t(entity: SyncEntity) {
    let m = this.data.get(entity);
    if (!m) this.data.set(entity, (m = new Map()));
    return m;
  }
  async put(entity: SyncEntity, rows: EntityRow[]) {
    const m = this.t(entity);
    for (const r of rows) m.set(r.id, structuredClone(r));
  }
  async delete(entity: SyncEntity, ids: string[]) {
    const m = this.t(entity);
    for (const id of ids) m.delete(id);
  }
  async get<T extends EntityRow>(entity: SyncEntity, id: string) {
    const r = this.t(entity).get(id);
    return r ? (structuredClone(r) as T) : null;
  }
  private filter(entity: SyncEntity, where?: Record<string, unknown>) {
    const rows = [...this.t(entity).values()];
    if (!where) return rows;
    return rows.filter((r) => Object.entries(where).every(([k, v]) => colValue(r[k]) === colValue(v)));
  }
  async list<E extends SyncEntity, T extends EntityRow>(entity: E, opts: ListOptions<E> = {}) {
    const rows = this.filter(entity, opts.where);
    const key = (opts.orderBy ?? "id") as string;
    rows.sort((a, b) => cmp(colValue(a[key]), colValue(b[key])) * (opts.desc ? -1 : 1));
    const off = opts.offset ?? 0;
    return rows.slice(off, opts.limit ? off + opts.limit : undefined).map((r) => structuredClone(r) as T);
  }
  async count(entity: SyncEntity, opts: Pick<ListOptions, "where"> = {}) {
    return this.filter(entity, opts.where).length;
  }
  async search<T extends EntityRow>(entity: SyncEntity, q: string, limit = 50) {
    const toks = tokenize(q);
    if (!toks.length) return [];
    const out: T[] = [];
    for (const r of this.t(entity).values()) {
      const words = searchBlob(entity, r).split(/[^\p{L}\p{N}]+/u);
      if (toks.every((t) => words.some((w) => w.startsWith(t)))) out.push(structuredClone(r) as T);
      if (out.length >= limit) break;
    }
    return out;
  }
  async clear(entity?: SyncEntity) {
    if (entity) this.t(entity).clear();
    else for (const m of this.data.values()) m.clear();
  }
  async getMeta<K extends MetaKey>(key: K) {
    return this.meta.has(key) ? (structuredClone(this.meta.get(key)) as MetaMap[K]) : null;
  }
  async setMeta<K extends MetaKey>(key: K, value: MetaMap[K]) {
    this.meta.set(key, structuredClone(value));
  }
  async deleteMeta(key: MetaKey) {
    this.meta.delete(key);
  }
  async enqueue(cmd: SyncCommand) {
    if (this.queue.some((e) => e.cmd.id === cmd.id)) return;
    this.queue.push({ cmd: structuredClone(cmd), queuedAt: new Date().toISOString(), attempts: 0 });
  }
  async outbox(limit = 100) {
    return structuredClone(this.queue.slice(0, limit));
  }
  async updateOutbox(id: string, patch: Partial<Pick<OutboxEntry, "attempts" | "lastError">>) {
    const e = this.queue.find((x) => x.cmd.id === id);
    if (e) Object.assign(e, patch);
  }
  async removeOutbox(ids: string[]) {
    const s = new Set(ids);
    this.queue = this.queue.filter((e) => !s.has(e.cmd.id));
  }
  async pendingCount() {
    return this.queue.length;
  }
  async wipe() {
    await this.clear();
    this.meta.clear();
    this.queue = [];
  }
}

function cmp(a: string | null, b: string | null) {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  // numérico si ambos lo son (folio, position)
  const na = Number(a), nb = Number(b);
  if (a.trim() !== "" && b.trim() !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a < b ? -1 : 1;
}

/** SqliteStore en el teléfono; MemoryStore en navegador (desarrollo, sin persistencia). */
export async function createDefaultStore(): Promise<LocalStore> {
  if (Capacitor.isNativePlatform()) {
    const { SqliteStore } = await import("./sqlite-store");
    const s = new SqliteStore();
    await s.init();
    return s;
  }
  const m = new MemoryStore();
  await m.init();
  return m;
}
