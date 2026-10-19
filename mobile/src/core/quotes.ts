import { buildItemSnapshots, catalogPriceMxn, type CatalogProduct, type ItemSnapshot } from "@domain/pricing";
import { canTransition } from "@domain/quote-status";
import { AppError } from "@domain/errors";
import { dec, type Dec } from "@domain/money";
import type { ProductKind, ProductLine, ProductStatus, QuoteStatus } from "@domain/types";
import type { EntityRow, PriceConflict, SessionUser, SyncCommand, SyncCommandType, SyncConfig } from "./api";
import { OFFLINE_LIMIT_MS, canCapture } from "./session";
import type { LocalStore } from "./store";

// ---------- Tipos ----------

export type QuoteSyncState = "pending" | "applied" | "conflict" | "rejected";

/** Metadatos locales de sincronización de una cotización (no los manda el servidor). */
export interface QuoteSync {
  state: QuoteSyncState;
  /** Último comando que afecta a la cotización. */
  commandId: string | null;
  commandType?: SyncCommandType;
  error?: string;
  /** Resultado del servidor en CONFLICT (p. ej. `{kind:"price", items}`). */
  conflict?: PriceConflict | unknown;
  /** La cotización ya existe en el servidor (create aplicado o llegó por pull). */
  onServer: boolean;
  /** `updatedAt` de la última versión del servidor (bloqueo optimista de `quote.update`). */
  baseUpdatedAt?: string;
}

export interface QuoteItemInput {
  productId: string;
  quantity: string;
  /** Porcentaje 0–100 como en la web ("10", "12.5"). */
  discountPct?: string;
  /** Precio unitario MXN manual (solo con `canOverridePrice`). */
  unitPrice?: string;
  details?: string;
}

export interface QuoteComplementInput { code: string; name: string; activities: string[] }

export interface QuoteInput {
  customerId: string;
  /** ISO o `yyyy-mm-dd`. */
  validUntil: string;
  currency?: "MXN" | "USD";
  notes?: string;
  deliveryTime?: string;
  warrantyMonths?: number;
  complements?: QuoteComplementInput[];
  items: QuoteItemInput[];
  /** Motivo del descuento (≤500), para el administrador que lo autoriza. */
  discountNote?: string;
  /** Vendedor asignado (solo con `canAssignSeller`). */
  sellerId?: string;
}

export type DiscountStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

/** Partida tal como la guarda el servidor (decimales string). `unitCost` no viaja al teléfono de VENTAS. */
export interface LocalQuoteItem {
  id: string;
  productId: string | null;
  position: number;
  sku: string;
  description: string;
  details: string | null;
  line: string;
  kind: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  unitCost?: string;
  origCurrency: string;
  origUnitPrice: string | null;
  fxRate: string;
  discountPct: string;
  taxRate: string;
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}

/** Fila local de Quote: misma forma que `/api/sync/pull` + `_sync` (+ `_input` en capturas del teléfono). */
export interface LocalQuote extends EntityRow {
  id: string;
  folio: number | null;
  /** `P-<iniciales>-<n>` cuando no había folio apartado (el definitivo llega al sincronizar). */
  provisionalFolio?: string | null;
  customerId: string;
  customerName: string;
  sellerId: string;
  sellerName: string;
  status: QuoteStatus;
  validUntil: string;
  currency: string;
  exchangeRate: string | null;
  notes: string | null;
  deliveryTime: string | null;
  complements: QuoteComplementInput[] | null;
  warrantyMonths: number | null;
  subtotal: string;
  discountTotal: string;
  taxTotal: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  origin: "WEB" | "MOBILE";
  /** Estado de autorización del descuento (el del servidor manda tras el pull). */
  discountStatus?: DiscountStatus;
  discountNote?: string | null;
  discountDecidedAt?: string | null;
  discountDecidedById?: string | null;
  items: LocalQuoteItem[];
  _sync?: QuoteSync;
  _input?: QuoteInput;
}

export interface QuotePreview {
  items: ItemSnapshot[];
  totals: { subtotal: Dec; discountTotal: Dec; taxTotal: Dec; total: Dec };
  /** TC USD→MXN usado (null si no aplica). */
  exchangeRate: Dec | null;
  /** Precio de lista MXN por partida (antes de descuento); null si se sobrescribió el precio. */
  listPrices: (Dec | null)[];
}

// ---------- Errores tipados ----------

/** Más de N días sin sincronizar (o nunca): solo consulta. */
export class CaptureBlockedError extends AppError {
  constructor(message = "Llevas demasiados días sin sincronizar. Conéctate para volver a cotizar.") {
    super(message, "FORBIDDEN");
    this.name = "CaptureBlockedError";
  }
}
/** Operación inválida sobre una cotización local (no existe, no es tuya, no es borrador, transición imposible…). */
export class QuoteRuleError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "QuoteRuleError";
  }
}

// ---------- Utilidades puras ----------

const PCT_RE = /^\d+(\.\d{1,2})?$/;
/** Acepta «10», «10%», «10,5», «10.5» → "10.5" (igual que `pctToFraction` de la web); null si es inválido. */
export function parsePct(s: string | undefined): string | null {
  const v = (s ?? "").trim().replace(/\s*%$/, "").replace(",", ".") || "0";
  return PCT_RE.test(v) && Number(v) <= 100 ? v : null;
}
/** "10" → "0.1000" (igual que `pctToFraction` de la web). */
export function pctToFraction(s: string | undefined, idx = 0): string {
  const v = parsePct(s);
  if (v === null) throw new QuoteRuleError(`Partida ${idx + 1}: porcentaje de descuento inválido.`);
  return dec(v).div(100).toFixed(4);
}
const normPct = (s: string | undefined) => dec(parsePct(s) ?? "0").toString();

/** Mensajes iguales a `assertDiscountCleared` del servidor. */
export const DISCOUNT_BLOCK_MSG: Partial<Record<DiscountStatus, string>> = {
  PENDING: "El descuento espera la autorización de un administrador. Podrás enviarla cuando lo autorice.",
  REJECTED: "Un administrador rechazó el descuento. Edita la cotización para cambiarlo o quitarlo.",
};
export function assertDiscountCleared(q: Pick<LocalQuote, "discountStatus">) {
  const m = q.discountStatus && DISCOUNT_BLOCK_MSG[q.discountStatus];
  if (m) throw new QuoteRuleError(m);
}

export function initials(name: string): string {
  const w = name.normalize("NFD").replace(/\p{M}/gu, "").split(/\s+/).filter(Boolean);
  return (w.length >= 2 ? w[0]![0]! + w[1]![0]! : (w[0] ?? "X").slice(0, 2)).toUpperCase().replace(/[^A-Z0-9]/g, "X");
}

/** Folio visible: `C-123` o `P-JP-1` (provisional). */
export const quoteFolioLabel = (q: Pick<LocalQuote, "folio" | "provisionalFolio">) =>
  q.folio !== null && q.folio !== undefined ? `C-${q.folio}` : (q.provisionalFolio ?? "C-?");
export const isProvisional = (q: Pick<LocalQuote, "folio">) => q.folio === null || q.folio === undefined;

/** Captura editable a partir de una cotización (local o del servidor). */
export function quoteToInput(q: LocalQuote): QuoteInput {
  if (q._input) return structuredClone(q._input);
  return {
    customerId: q.customerId,
    validUntil: q.validUntil,
    currency: q.currency === "USD" ? "USD" : "MXN",
    ...(q.notes && { notes: q.notes }),
    ...(q.deliveryTime && { deliveryTime: q.deliveryTime }),
    ...(q.warrantyMonths !== null && q.warrantyMonths !== undefined && { warrantyMonths: q.warrantyMonths }),
    complements: Array.isArray(q.complements) ? q.complements : [],
    ...(q.discountNote && { discountNote: q.discountNote }),
    items: q.items.filter((i) => i.productId).map((i) => {
      const list = i.origUnitPrice !== null ? dec(i.origUnitPrice).mul(i.fxRate).toDecimalPlaces(2) : null;
      return {
        productId: i.productId!,
        quantity: dec(i.quantity).toString(),
        discountPct: dec(i.discountPct).mul(100).toString(),
        ...(list && !list.eq(i.unitPrice) && { unitPrice: dec(i.unitPrice).toFixed(2) }),
        ...(i.details && { details: i.details }),
      };
    }),
  };
}

const toIso = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T12:00:00.000Z` : new Date(d).toISOString());

function toCatalog(r: EntityRow): CatalogProduct {
  return {
    id: r.id,
    sku: String(r.sku ?? ""),
    description: String(r.description ?? ""),
    line: r.line as ProductLine,
    kind: r.kind as ProductKind,
    unit: String(r.unit ?? "PZA"),
    cost: dec(r.cost as string | undefined),
    shipping: dec(r.shipping as string | undefined),
    consumables: dec(r.consumables as string | undefined),
    currency: r.currency === "USD" ? "USD" : "MXN",
    price: dec(r.price as string | undefined),
    taxRate: dec(r.taxRate as string | undefined),
    status: (r.status ?? "ACTIVE") as ProductStatus,
  };
}

// ---------- Servicio ----------

export interface QuoteServiceOptions {
  store: LocalStore;
  /** Se llama tras cada cambio local (para refrescar pendientes/conflictos en la UI). */
  onChange?: () => void | Promise<void>;
  /** Espera a que termine un push en curso antes de reescribir el outbox. */
  beforeWrite?: () => Promise<void>;
  /** Motivo por el que la captura está bloqueada aunque haya sincronización reciente (p. ej. actualización obligatoria). */
  captureBlocked?: () => string | null;
  now?: () => number;
  uuid?: () => string;
}

/** Cotizaciones locales (borradores del teléfono) + outbox. */
export class QuoteService {
  constructor(private o: QuoteServiceOptions) {}

  private now() { return this.o.now?.() ?? Date.now(); }
  private uuid() { return this.o.uuid?.() ?? crypto.randomUUID(); }
  private async user(): Promise<SessionUser> {
    const u = await this.o.store.getMeta("user");
    if (!u) throw new QuoteRuleError("Sin sesión.");
    return u;
  }
  async config(): Promise<SyncConfig | null> { return this.o.store.getMeta("config"); }

  /** ¿Se puede capturar? (última sincronización ≤ `maxOfflineDays`, por omisión 7). */
  async canCapture(): Promise<boolean> {
    const [last, cfg] = await Promise.all([this.o.store.getMeta("lastSyncAt"), this.config()]);
    const limit = cfg?.maxOfflineDays ? cfg.maxOfflineDays * 86_400_000 : OFFLINE_LIMIT_MS;
    return canCapture(last, this.now(), limit);
  }
  private async assertCapture() {
    const blocked = this.o.captureBlocked?.();
    if (blocked) throw new CaptureBlockedError(blocked);
    if (!(await this.canCapture())) throw new CaptureBlockedError();
  }

  /** Vista previa con el catálogo local (misma regla que el servidor: `buildItemSnapshots`). */
  async buildQuote(input: QuoteInput): Promise<QuotePreview> {
    const { store } = this.o;
    const cfg = await this.config();
    const catalog = new Map<string, CatalogProduct>();
    for (const it of input.items) {
      if (catalog.has(it.productId)) continue;
      const p = await store.get("Product", it.productId);
      if (p) catalog.set(p.id, toCatalog(p));
    }
    const usesUsd = input.currency === "USD" || [...catalog.values()].some((p) => p.currency === "USD");
    const rate = usesUsd ? (await store.list("ExchangeRate", { orderBy: "createdAt", desc: true, limit: 1 }))[0] : undefined;
    const fx = rate ? dec(rate.rate as string) : null;
    if (input.currency === "USD" && !fx) throw new AppError("No hay tipo de cambio USD descargado; sincroniza antes de cotizar en dólares.");
    const requested = input.items.map((i, idx) => ({
      productId: i.productId,
      quantity: i.quantity,
      discountPct: pctToFraction(i.discountPct, idx),
      ...(i.unitPrice !== undefined && i.unitPrice !== "" && { unitPrice: i.unitPrice }),
      ...(i.details !== undefined && { details: i.details }),
    }));
    const { items, totals } = buildItemSnapshots(requested, catalog, { canOverridePrice: cfg?.canOverridePrice ?? false, fx });
    const listPrices = items.map((s, idx) => {
      const list = catalogPriceMxn(catalog.get(s.productId)!, fx);
      return requested[idx]!.unitPrice !== undefined && !list.eq(s.unitPrice) ? null : list;
    });
    return { items, totals, exchangeRate: fx, listPrices };
  }

  /** Payload común de quote.create / quote.update (porcentajes 0–100, decimales string). */
  private async payload(input: QuoteInput, pv: QuotePreview) {
    const cfg = await this.config();
    const note = input.discountNote?.trim().slice(0, 500);
    return {
      customerId: input.customerId,
      validUntil: toIso(input.validUntil),
      currency: input.currency ?? "MXN",
      ...(input.notes?.trim() && { notes: input.notes.trim() }),
      ...(input.deliveryTime?.trim() && { deliveryTime: input.deliveryTime.trim() }),
      ...(input.warrantyMonths !== undefined && { warrantyMonths: input.warrantyMonths }),
      ...(note && { discountNote: note }),
      ...(cfg?.canAssignSeller && input.sellerId && { sellerId: input.sellerId }),
      complements: (input.complements ?? []).map(({ code, name, activities }) => ({ code, name, activities })),
      items: input.items.map((i, idx) => {
        const list = pv.listPrices[idx];
        return {
          productId: i.productId,
          quantity: i.quantity,
          discountPct: normPct(i.discountPct),
          ...(list ? { clientListPrice: list.toFixed(2) } : { unitPrice: dec(i.unitPrice).toFixed(2) }),
          ...(i.details?.trim() && { details: i.details.trim() }),
        };
      }),
      ...(pv.exchangeRate && { clientExchangeRate: pv.exchangeRate.toFixed(4) }),
    };
  }

  private async rowFrom(base: Partial<LocalQuote> & Pick<LocalQuote, "id">, input: QuoteInput, pv: QuotePreview): Promise<LocalQuote> {
    const user = await this.user();
    const cfg = await this.config();
    const hasDiscount = pv.items.some((i) => dec(i.discountPct).gt(0));
    // Una edición con el mismo descuento ya autorizado lo conserva (como la web).
    const sameDiscount = base.discountStatus === "APPROVED" && base.items?.length === pv.items.length
      && pv.items.every((i, idx) => base.items![idx]!.productId === i.productId && dec(base.items![idx]!.discountPct).eq(i.discountPct));
    const discountStatus: DiscountStatus = !hasDiscount ? "NONE"
      : sameDiscount || !(cfg?.discountNeedsApproval ?? true) ? "APPROVED" : "PENDING";
    const customer = await this.o.store.get("Customer", input.customerId);
    if (!customer) throw new QuoteRuleError("Cliente no encontrado en el teléfono.");
    const nowIso = new Date(this.now()).toISOString();
    const s = (d: Dec) => d.toString();
    return {
      folio: null,
      sellerId: user.id,
      sellerName: user.name,
      status: "DRAFT",
      createdAt: nowIso,
      origin: "MOBILE",
      ...base,
      customerId: input.customerId,
      customerName: String(customer.legalName ?? ""),
      validUntil: toIso(input.validUntil),
      currency: input.currency ?? "MXN",
      exchangeRate: pv.exchangeRate ? pv.exchangeRate.toFixed(4) : null,
      notes: input.notes?.trim() || null,
      deliveryTime: input.deliveryTime?.trim() || null,
      complements: input.complements?.length ? input.complements : null,
      warrantyMonths: input.warrantyMonths ?? null,
      ...(cfg?.canAssignSeller && input.sellerId && { sellerId: input.sellerId }),
      discountStatus,
      discountNote: input.discountNote?.trim().slice(0, 500) || null,
      ...(discountStatus !== base.discountStatus && { discountDecidedAt: null, discountDecidedById: null }),
      subtotal: s(pv.totals.subtotal), discountTotal: s(pv.totals.discountTotal), taxTotal: s(pv.totals.taxTotal), total: s(pv.totals.total),
      updatedAt: nowIso,
      items: pv.items.map((i) => ({
        id: `${base.id}:${i.position}`, productId: i.productId, position: i.position, sku: i.sku, description: i.description,
        details: i.details, line: i.line, kind: i.kind, unit: i.unit, quantity: s(i.quantity), unitPrice: s(i.unitPrice),
        origCurrency: i.origCurrency, origUnitPrice: s(i.origUnitPrice), fxRate: s(i.fxRate), discountPct: s(i.discountPct),
        taxRate: s(i.taxRate), subtotal: s(i.subtotal), discount: s(i.discount), tax: s(i.tax), total: s(i.total),
      })),
      _input: structuredClone(input),
    } as LocalQuote;
  }

  private async enqueue(type: SyncCommandType, payload: Record<string, unknown>): Promise<SyncCommand> {
    const cmd: SyncCommand = { id: this.uuid(), type, capturedAt: new Date(this.now()).toISOString(), payload };
    await this.o.store.enqueue(cmd);
    return cmd;
  }

  private async changed() { await this.o.onChange?.(); }

  /** Toma el folio apartado más bajo; sin folios → etiqueta provisional. */
  private async takeFolio(user: SessionUser): Promise<{ folio: number | null; provisionalFolio: string | null }> {
    const { store } = this.o;
    const folios = (await store.getMeta("folios")) ?? [];
    if (folios.length) {
      const [folio, ...rest] = [...folios].sort((a, b) => a - b);
      await store.setMeta("folios", rest);
      return { folio: folio!, provisionalFolio: null };
    }
    const n = ((await store.getMeta("provisionalSeq")) ?? 0) + 1;
    await store.setMeta("provisionalSeq", n);
    return { folio: null, provisionalFolio: `P-${initials(user.name)}-${n}` };
  }

  /** Nueva cotización (borrador) guardada al instante + `quote.create` en el outbox. */
  async createQuote(input: QuoteInput): Promise<LocalQuote> {
    await this.assertCapture();
    const pv = await this.buildQuote(input);
    const user = await this.user();
    const id = this.uuid();
    const { folio, provisionalFolio } = await this.takeFolio(user);
    const deviceId = await this.o.store.getMeta("deviceId");
    const catalogSeq = await this.o.store.getMeta("cursor");
    const payload = { id, ...(folio !== null && { folio }), ...(catalogSeq && { catalogSeq }), ...(await this.payload(input, pv)) };
    const cmd = await this.enqueue("quote.create", payload);
    const row = await this.rowFrom({ id, folio, provisionalFolio, deviceId: deviceId ?? null, offlineCreatedAt: cmd.capturedAt }, input, pv);
    row._sync = { state: "pending", commandId: cmd.id, commandType: "quote.create", onServer: false };
    await this.o.store.put("Quote", [row]);
    await this.changed();
    return row;
  }

  private async own(quoteId: string): Promise<LocalQuote> {
    const q = await this.getQuote(quoteId);
    if (!q) throw new QuoteRuleError("Cotización no encontrada.");
    const user = await this.user();
    if (q.sellerId !== user.id && !(await this.config())?.canAssignSeller) throw new QuoteRuleError("Solo puedes modificar tus cotizaciones.");
    return q;
  }

  /** Edita un borrador propio. Si su comando aún no se envió, se reescribe; si no, `quote.update` con `baseUpdatedAt`. */
  async updateQuote(quoteId: string, input: QuoteInput): Promise<LocalQuote> {
    await this.assertCapture();
    await this.o.beforeWrite?.();
    const q = await this.own(quoteId);
    if (q.status !== "DRAFT") throw new QuoteRuleError("Solo se pueden editar cotizaciones en borrador.");
    const pv = await this.buildQuote(input);
    const sync: QuoteSync = q._sync ?? { state: "applied", commandId: null, onServer: true, baseUpdatedAt: q.updatedAt };
    const body = await this.payload(input, pv);
    let cmdId: string | null = null;
    let type: SyncCommandType;
    const pendingRewritable = sync.state === "pending" && sync.commandId && (sync.commandType === "quote.create" || sync.commandType === "quote.update");
    const old = pendingRewritable ? (await this.o.store.outbox(1000)).find((e) => e.cmd.id === sync.commandId)?.cmd : undefined;
    if (old) {
      const keep = old.type === "quote.create"
        ? { id: q.id, ...(q.folio !== null && { folio: q.folio }), ...(old.payload.catalogSeq !== undefined && { catalogSeq: old.payload.catalogSeq }) }
        : { quoteId: q.id, baseUpdatedAt: old.payload.baseUpdatedAt };
      if (await this.o.store.replaceOutbox({ ...old, capturedAt: new Date(this.now()).toISOString(), payload: { ...keep, ...body } })) {
        cmdId = old.id;
      }
    }
    if (cmdId) type = sync.commandType!;
    else if (sync.onServer) {
      type = "quote.update";
      cmdId = (await this.enqueue(type, { quoteId: q.id, baseUpdatedAt: sync.baseUpdatedAt ?? q.updatedAt, ...body })).id;
    } else {
      // Nunca llegó al servidor (create rechazado): se vuelve a crear con el mismo id.
      type = "quote.create";
      cmdId = (await this.enqueue(type, { id: q.id, ...(q.folio !== null && { folio: q.folio }), ...body })).id;
    }
    const { _sync: _s, _input: _i, ...base } = q;
    const row = await this.rowFrom(base, input, pv);
    row._sync = { state: "pending", commandId: cmdId, commandType: type, onServer: sync.onServer, ...(sync.baseUpdatedAt && { baseUpdatedAt: sync.baseUpdatedAt }) };
    await this.o.store.put("Quote", [row]);
    await this.changed();
    return row;
  }

  /** Cambio manual de estado (validado con `QUOTE_TRANSITIONS`). */
  async changeStatus(quoteId: string, to: QuoteStatus): Promise<LocalQuote> {
    await this.assertCapture();
    const q = await this.own(quoteId);
    if (to === "CONVERTED" || to === "DRAFT" || !canTransition(q.status, to)) throw new QuoteRuleError(`No se puede pasar de ${q.status} a ${to}.`);
    if (to === "SENT" || to === "ACCEPTED") assertDiscountCleared(q);
    const cmd = await this.enqueue("quote.status", { quoteId: q.id, to });
    const sync = q._sync ?? { state: "applied", commandId: null, onServer: true, baseUpdatedAt: q.updatedAt };
    const row: LocalQuote = { ...q, status: to, _sync: { ...sync, state: "pending", commandId: cmd.id, commandType: "quote.status", error: undefined, conflict: undefined } };
    await this.o.store.put("Quote", [row]);
    await this.changed();
    return row;
  }

  /** Encola el envío por correo (lo manda el servidor al sincronizar, con el PDF definitivo). */
  async emailQuote(quoteId: string, mail: { to: string[]; cc?: string[]; message?: string }): Promise<SyncCommand> {
    await this.assertCapture();
    const q = await this.getQuote(quoteId);
    if (!q) throw new QuoteRuleError("Cotización no encontrada.");
    assertDiscountCleared(q);
    const clean = (l: string[] = []) => l.map((s) => s.trim()).filter(Boolean);
    const to = clean(mail.to), cc = clean(mail.cc);
    const bad = [...to, ...cc].find((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (!to.length) throw new QuoteRuleError("Agrega al menos un destinatario.");
    if (bad) throw new QuoteRuleError(`Correo inválido: ${bad}`);
    const cmd = await this.enqueue("quote.email", { quoteId: q.id, to, cc, message: mail.message?.trim() ?? "" });
    await this.changed();
    return cmd;
  }

  async getQuote(id: string): Promise<LocalQuote | null> { return this.o.store.get<LocalQuote>("Quote", id); }

  /** Lista local (más recientes primero). `q` busca por folio/cliente/vendedor. */
  async listQuotes(opts: { q?: string; status?: QuoteStatus; customerId?: string; limit?: number; offset?: number } = {}): Promise<LocalQuote[]> {
    const { store } = this.o;
    if (opts.q?.trim()) {
      const rows = await store.search<LocalQuote>("Quote", opts.q, opts.limit ?? 50);
      return rows.filter((r) => (!opts.status || r.status === opts.status) && (!opts.customerId || r.customerId === opts.customerId));
    }
    return store.list<"Quote", LocalQuote>("Quote", {
      where: { ...(opts.status && { status: opts.status }), ...(opts.customerId && { customerId: opts.customerId }) },
      orderBy: "updatedAt", desc: true, limit: opts.limit ?? 100, offset: opts.offset,
    });
  }

  /** Cotizaciones con conflicto o rechazo pendiente de revisar. */
  async listIssues(): Promise<LocalQuote[]> {
    const rows = await this.o.store.list<"Quote", LocalQuote>("Quote", { orderBy: "updatedAt", desc: true });
    return rows.filter((r) => r._sync?.state === "conflict" || r._sync?.state === "rejected");
  }
}
