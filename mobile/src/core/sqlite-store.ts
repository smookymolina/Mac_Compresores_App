import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection, type capSQLiteSet } from "@capacitor-community/sqlite";
import { SYNC_ENTITIES, type EntityRow, type SyncCommand, type SyncEntity } from "./api";
import { ENTITY_INDEX, colValue, searchBlob, tokenize, type ListOptions, type LocalStore, type MetaKey, type MetaMap, type OutboxEntry } from "./store";

/**
 * Base local cifrada (SQLCipher). La llave se genera una vez y la guarda el plugin con su API de
 * secreto (Android Keystore / iOS Keychain): `setEncryptionSecret` + conexión en modo "secret".
 * Una tabla por entidad: `id` + `json` + columnas indexadas + `search`. Product: FTS5 (external content).
 */
const DB_NAME = "maccampo";
const DB_VERSION = 1;
const FTS_COLS = ["sku", "oemPartNumber", "description", "searchText"] as const;

const table = (e: SyncEntity) => `e_${e}`;
const q = (c: string) => `"${c}"`;
const sqlValue = (v: unknown) => (typeof v === "number" ? v : typeof v === "boolean" ? String(v) : colValue(v));
/** Columnas físicas de la tabla de una entidad (sin id/json/search/rid). */
const physCols = (e: SyncEntity): string[] =>
  e === "Product" ? [...new Set<string>([...ENTITY_INDEX.Product, ...FTS_COLS])] : [...ENTITY_INDEX[e]];

function randomSecret() {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function schema(): string[] {
  const out: string[] = [
    `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL, queued_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT)`,
  ];
  for (const e of SYNC_ENTITIES) {
    const cols = physCols(e).map((c) => `${q(c)}`).join(", ");
    out.push(`CREATE TABLE IF NOT EXISTS ${table(e)} (rid INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, json TEXT NOT NULL, search TEXT, ${cols})`);
    for (const c of ENTITY_INDEX[e]) out.push(`CREATE INDEX IF NOT EXISTS ix_${e}_${c} ON ${table(e)} (${q(c)})`);
  }
  const t = table("Product");
  const f = FTS_COLS.map(q).join(", ");
  const nf = FTS_COLS.map((c) => `new.${q(c)}`).join(", ");
  const of = FTS_COLS.map((c) => `old.${q(c)}`).join(", ");
  out.push(
    `CREATE VIRTUAL TABLE IF NOT EXISTS product_fts USING fts5(${f}, content='${t}', content_rowid='rid', tokenize='unicode61 remove_diacritics 2')`,
    `CREATE TRIGGER IF NOT EXISTS product_ai AFTER INSERT ON ${t} BEGIN INSERT INTO product_fts(rowid, ${f}) VALUES (new.rid, ${nf}); END`,
    `CREATE TRIGGER IF NOT EXISTS product_ad AFTER DELETE ON ${t} BEGIN INSERT INTO product_fts(product_fts, rowid, ${f}) VALUES ('delete', old.rid, ${of}); END`,
    `CREATE TRIGGER IF NOT EXISTS product_au AFTER UPDATE ON ${t} BEGIN INSERT INTO product_fts(product_fts, rowid, ${f}) VALUES ('delete', old.rid, ${of}); INSERT INTO product_fts(rowid, ${f}) VALUES (new.rid, ${nf}); END`,
  );
  return out;
}

export class SqliteStore implements LocalStore {
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private conn: SQLiteDBConnection | null = null;

  private get db() {
    if (!this.conn) throw new Error("SqliteStore: llama init() primero.");
    return this.conn;
  }

  async init() {
    if (this.conn) return;
    if (!(await this.sqlite.isSecretStored()).result) await this.sqlite.setEncryptionSecret(randomSecret());
    const consistent = (await this.sqlite.checkConnectionsConsistency()).result;
    const exists = (await this.sqlite.isConnection(DB_NAME, false)).result;
    this.conn = consistent && exists
      ? await this.sqlite.retrieveConnection(DB_NAME, false)
      : await this.sqlite.createConnection(DB_NAME, true, "secret", DB_VERSION, false);
    await this.conn.open();
    // TODO(dispositivo): validar en Android/iOS que `execute` acepte los CREATE TRIGGER uno por uno.
    for (const s of schema()) await this.conn.execute(s, false);
  }

  async put(entity: SyncEntity, rows: EntityRow[]) {
    if (!rows.length) return;
    const cols = physCols(entity);
    const all = ["id", "json", "search", ...cols];
    const sql = `INSERT INTO ${table(entity)} (${all.map(q).join(", ")}) VALUES (${all.map(() => "?").join(", ")})
      ON CONFLICT(id) DO UPDATE SET ${all.slice(1).map((c) => `${q(c)} = excluded.${q(c)}`).join(", ")}`;
    const set: capSQLiteSet[] = rows.map((r) => ({
      statement: sql,
      values: [r.id, JSON.stringify(r), searchBlob(entity, r), ...cols.map((c) => sqlValue(r[c]))],
    }));
    for (let i = 0; i < set.length; i += 500) await this.db.executeSet(set.slice(i, i + 500), true);
  }

  async delete(entity: SyncEntity, ids: string[]) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      await this.db.run(`DELETE FROM ${table(entity)} WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk, true);
    }
  }

  private rows<T>(values: { json: string }[] | undefined): T[] {
    return (values ?? []).map((v) => JSON.parse(v.json) as T);
  }

  async get<T extends EntityRow>(entity: SyncEntity, id: string): Promise<T | null> {
    const r = await this.db.query(`SELECT json FROM ${table(entity)} WHERE id = ?`, [id]);
    return this.rows<T>(r.values)[0] ?? null;
  }

  private where(entity: SyncEntity, where?: Record<string, unknown>) {
    const allowed = new Set<string>(ENTITY_INDEX[entity]);
    const parts: string[] = [];
    const values: unknown[] = [];
    for (const [k, v] of Object.entries(where ?? {})) {
      if (!allowed.has(k)) throw new Error(`Columna no indexada: ${entity}.${k}`);
      if (v === null) parts.push(`${q(k)} IS NULL`);
      else { parts.push(`${q(k)} = ?`); values.push(sqlValue(v)); }
    }
    return { sql: parts.length ? `WHERE ${parts.join(" AND ")}` : "", values };
  }

  async list<E extends SyncEntity, T extends EntityRow>(entity: E, opts: ListOptions<E> = {}) {
    const w = this.where(entity, opts.where as Record<string, unknown> | undefined);
    const order = opts.orderBy && opts.orderBy !== "id" && (ENTITY_INDEX[entity] as readonly string[]).includes(opts.orderBy) ? q(opts.orderBy) : "id";
    const sql = `SELECT json FROM ${table(entity)} ${w.sql} ORDER BY ${order} ${opts.desc ? "DESC" : "ASC"} LIMIT ? OFFSET ?`;
    const r = await this.db.query(sql, [...w.values, opts.limit ?? -1, opts.offset ?? 0]);
    return this.rows<T>(r.values);
  }

  async count(entity: SyncEntity, opts: Pick<ListOptions, "where"> = {}) {
    const w = this.where(entity, opts.where as Record<string, unknown> | undefined);
    const r = await this.db.query(`SELECT COUNT(*) AS n FROM ${table(entity)} ${w.sql}`, w.values);
    return Number((r.values?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async search<T extends EntityRow>(entity: SyncEntity, text: string, limit = 50) {
    const toks = tokenize(text);
    if (!toks.length) return [];
    if (entity === "Product") {
      const match = toks.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");
      const r = await this.db.query(
        `SELECT p.json FROM product_fts f JOIN ${table("Product")} p ON p.rid = f.rowid WHERE product_fts MATCH ? ORDER BY bm25(product_fts) LIMIT ?`,
        [match, limit],
      );
      return this.rows<T>(r.values);
    }
    // Resto: LIKE sobre el texto normalizado (volúmenes chicos).
    const parts = toks.map(() => `(search LIKE ? OR search LIKE ?)`).join(" AND ");
    const values = toks.flatMap((t) => [`${t}%`, `% ${t}%`]);
    const r = await this.db.query(`SELECT json FROM ${table(entity)} WHERE ${parts} LIMIT ?`, [...values, limit]);
    return this.rows<T>(r.values);
  }

  async clear(entity?: SyncEntity) {
    const list = entity ? [entity] : [...SYNC_ENTITIES];
    await this.db.executeSet(list.map((e) => ({ statement: `DELETE FROM ${table(e)}`, values: [] })), true);
  }

  async getMeta<K extends MetaKey>(key: K) {
    const r = await this.db.query(`SELECT value FROM meta WHERE key = ?`, [key]);
    const v = (r.values?.[0] as { value?: string } | undefined)?.value;
    return v === undefined ? null : (JSON.parse(v) as MetaMap[K]);
  }
  async setMeta<K extends MetaKey>(key: K, value: MetaMap[K]) {
    await this.db.run(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, JSON.stringify(value)], true);
  }
  async deleteMeta(key: MetaKey) {
    await this.db.run(`DELETE FROM meta WHERE key = ?`, [key], true);
  }

  async enqueue(cmd: SyncCommand) {
    await this.db.run(`INSERT OR IGNORE INTO outbox (id, json, queued_at) VALUES (?, ?, ?)`, [cmd.id, JSON.stringify(cmd), new Date().toISOString()], true);
  }
  async outbox(limit = 100): Promise<OutboxEntry[]> {
    const r = await this.db.query(`SELECT json, queued_at, attempts, last_error FROM outbox ORDER BY rowid ASC LIMIT ?`, [limit]);
    return (r.values ?? []).map((v: { json: string; queued_at: string; attempts: number; last_error: string | null }) => ({
      cmd: JSON.parse(v.json) as SyncCommand, queuedAt: v.queued_at, attempts: v.attempts, ...(v.last_error && { lastError: v.last_error }),
    }));
  }
  async updateOutbox(id: string, patch: Partial<Pick<OutboxEntry, "attempts" | "lastError">>) {
    if (patch.attempts !== undefined) await this.db.run(`UPDATE outbox SET attempts = ? WHERE id = ?`, [patch.attempts, id], true);
    if (patch.lastError !== undefined) await this.db.run(`UPDATE outbox SET last_error = ? WHERE id = ?`, [patch.lastError, id], true);
  }
  async removeOutbox(ids: string[]) {
    if (!ids.length) return;
    await this.db.run(`DELETE FROM outbox WHERE id IN (${ids.map(() => "?").join(",")})`, ids, true);
  }
  async replaceOutbox(cmd: SyncCommand) {
    const r = await this.db.run(`UPDATE outbox SET json = ? WHERE id = ?`, [JSON.stringify(cmd), cmd.id], true);
    return Number(r.changes?.changes ?? 0) > 0;
  }
  async pendingCount() {
    const r = await this.db.query(`SELECT COUNT(*) AS n FROM outbox`);
    return Number((r.values?.[0] as { n?: number } | undefined)?.n ?? 0);
  }

  async wipe() {
    await this.clear();
    await this.db.executeSet([{ statement: `DELETE FROM meta`, values: [] }, { statement: `DELETE FROM outbox`, values: [] }], true);
  }
}
