/**
 * Cliente HTTP de la API de sincronización (`/api/sync/*`, `/api/app/version`).
 * Contrato: ver src/modules/sync/* del servidor y docs/v1.4.0-pruebas-locales.md §6.
 * BigInt (seq/cursor) y Decimal llegan como string.
 */

export const SYNC_PROTOCOL = 1;

export const SYNC_ENTITIES = ["Product", "Customer", "Quote", "Sale", "StockBalance", "Warehouse", "ExchangeRate", "ComplementPackage"] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

/** Fila tal como la manda el servidor (JSON con `id`). */
export type EntityRow = { id: string } & Record<string, unknown>;

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roleName: string;
  permissions: string[];
}

export interface RegisterInput {
  email: string;
  password: string;
  deviceName: string;
  platform: "ANDROID" | "IOS";
  appVersion: string;
}
export interface RegisterResponse { token: string; deviceId: string; serverSeq: string; user: SessionUser }
export interface BootstrapPage { entity: SyncEntity; items: EntityRow[]; next: string | null; serverSeq?: string }
export interface PulledChange { entity: SyncEntity; id: string; deleted: boolean; data: EntityRow | null }
export interface PullResponse { changes: PulledChange[]; cursor: string; hasMore: boolean }
export interface AppVersionInfo { latest: string; minimum: string; androidUrl: string | null; iosUrl: string | null; notes: string }
export interface FoliosResponse { folios: number[] }

export type SyncCommandType =
  | "customer.save" | "customer.contact.add" | "customer.contact.remove" | "customer.address.add" | "customer.address.remove"
  | "quote.create" | "quote.update" | "quote.status" | "quote.email"
  | "sale.convert" | "payment.register" | "inventory.movement";
/** Comando del outbox (fase 3). `id` = UUID generado en el teléfono (idempotencia). */
export interface SyncCommand<P = Record<string, unknown>> { id: string; type: SyncCommandType; capturedAt: string; payload: P }
export type PushStatus = "APPLIED" | "REJECTED" | "CONFLICT" | "retry";
export interface PushResult { id: string; status: PushStatus; result?: unknown; error?: string }
export interface PushResponse { results: PushResult[] }
/** Estado guardado de un comando de este dispositivo (`GET /api/sync/commands?ids=`). */
export interface CommandState { id: string; status: "APPLIED" | "REJECTED" | "CONFLICT"; result?: unknown; error?: string | null; resolvedAt?: string | null }
/** Conflicto de precio de `quote.create`/`quote.update`. */
export interface PriceConflict { kind: "price"; items: { productId: string; sku: string; clientPrice: string; serverPrice: string }[] }
/** Conflicto de `customer.save`: el RFC ya existe en otro cliente. */
export interface DuplicateRfcConflict { kind: "duplicate_rfc"; rfc: string }
/** Conflicto de `sale.convert` / `inventory.movement`: existencia insuficiente. */
export interface StockConflict { kind: "stock"; warehouseId: string; items: { productId: string; sku: string; requested: string; available: string }[] }
export type SyncConflict = PriceConflict | DuplicateRfcConflict | StockConflict;
/** Resultado APPLIED de `sale.convert`. */
export interface SaleConvertResult { saleId: string; folio: number }
/** `GET /api/sync/config`. */
export interface SyncConfig {
  bankInfo: string[];
  /** PNG del bloque del asesor en base64 (o null). */
  sellerBlockPng: string | null;
  /** Fracción, p. ej. "0.15". */
  maxDiscountPct: string;
  canOverridePrice: boolean;
  priceGraceDays: number;
  maxOfflineDays: number;
}

// ---------- Errores tipados ----------

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly body?: unknown) {
    super(message);
    this.name = new.target.name;
  }
}
/** 401: token inválido o dispositivo revocado → borrar datos locales y sesión. */
export class UnauthorizedError extends ApiError {}
/** 403: usuario sin acceso móvil / desactivado, o límite de intentos. */
export class ForbiddenError extends ApiError {}
/** 409 con `upgrade: true`: versión de protocolo vieja → actualizar la app. */
export class UpgradeError extends ApiError {}
/** 410 `RESYNC`: el cursor ya no es válido → borrar entidades y volver a descargar. */
export class ResyncError extends ApiError {}
/** 400/404/409 (sin upgrade): petición rechazada. */
export class RequestError extends ApiError {}
/** 5xx o respuesta ilegible. */
export class ServerError extends ApiError {}
/** Sin red, DNS, timeout. */
export class OfflineError extends ApiError {
  constructor(message = "Sin conexión con el servidor.") { super(message, 0, "OFFLINE"); }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | null> | string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(opts: ApiClientOptions) {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const doFetch = opts.fetch ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));

  async function request<T>(method: "GET" | "POST", path: string, o: { body?: unknown; auth?: boolean; protocol?: boolean } = {}): Promise<T> {
    const { auth = true, protocol = true } = o;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (protocol) headers["X-Sync-Protocol"] = String(SYNC_PROTOCOL);
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (auth) {
      const token = await opts.getToken();
      if (!token) throw new UnauthorizedError("Sin sesión del dispositivo.", 401, "UNAUTHENTICATED");
      headers.Authorization = `Bearer ${token}`;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: ctrl.signal });
    } catch {
      throw new OfflineError(ctrl.signal.aborted ? "El servidor tardó demasiado en responder." : undefined);
    } finally {
      clearTimeout(timer);
    }
    let body: unknown = null;
    try {
      const text = await res.text();
      body = text ? JSON.parse(text) : null;
    } catch {
      if (res.ok) throw new ServerError("Respuesta inválida del servidor.", res.status);
    }
    if (res.ok) return body as T;
    const b = (body ?? {}) as { error?: string; code?: string; upgrade?: boolean };
    const msg = b.error ?? `Error ${res.status}`;
    if (res.status === 401) throw new UnauthorizedError(msg, 401, b.code, body);
    if (res.status === 403) throw new ForbiddenError(msg, 403, b.code, body);
    if (res.status === 409 && b.upgrade) throw new UpgradeError(msg, 409, b.code, body);
    if (res.status === 410) throw new ResyncError(msg, 410, b.code ?? "RESYNC", body);
    if (res.status >= 500) throw new ServerError(msg, res.status, b.code, body);
    throw new RequestError(msg, res.status, b.code, body);
  }

  const qs = (p: Record<string, string | number | undefined>) => {
    const s = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "") s.set(k, String(v));
    return s.toString();
  };

  return {
    version: () => request<AppVersionInfo>("GET", "/api/app/version", { auth: false, protocol: false }),
    register: (input: RegisterInput) => request<RegisterResponse>("POST", "/api/sync/register", { body: input, auth: false }),
    logout: () => request<{ ok: true }>("POST", "/api/sync/logout"),
    bootstrap: (entity: SyncEntity, after?: string, limit = 1000) => request<BootstrapPage>("GET", `/api/sync/bootstrap?${qs({ entity, after, limit })}`),
    pull: (cursor: string, limit = 500) => request<PullResponse>("GET", `/api/sync/pull?${qs({ cursor, limit })}`),
    /** Fase 3: aparta 1–25 folios para cotizar sin conexión. */
    folios: (count: number) => request<FoliosResponse>("POST", "/api/sync/folios", { body: { count } }),
    /** Fase 3: envía hasta 100 comandos del outbox. */
    push: (commands: SyncCommand[]) => request<PushResponse>("POST", "/api/sync/push", { body: { commands } }),
    /** Estado de comandos ya enviados (p. ej. conflictos que gerencia resolvió). */
    commands: (ids: string[]) => request<CommandState[] | { commands: CommandState[] }>("GET", `/api/sync/commands?${qs({ ids: ids.join(",") })}`)
      .then((r) => (Array.isArray(r) ? r : r?.commands ?? [])),
    /** Datos bancarios, bloque del asesor y reglas de captura. */
    config: () => request<SyncConfig>("GET", "/api/sync/config"),
  };
}
