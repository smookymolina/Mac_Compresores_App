import "server-only";
import type { Device, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { customerScope } from "@/modules/customers/service";
import { quoteScope } from "@/modules/quotes/service";
import { saleScope } from "@/modules/sales/service";

/** Entidades que registra la bitácora `SyncChange` (ver migración offline_sync). */
export const SYNC_ENTITIES = ["Product", "Customer", "Quote", "Sale", "StockBalance", "Warehouse", "ExchangeRate", "ComplementPackage"] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];
export const isSyncEntity = (e: string): e is SyncEntity => (SYNC_ENTITIES as readonly string[]).includes(e);

type Row = { id: string; data: Record<string, unknown> };
/** Filtro de carga: por ids concretos (pull) o por página ordenada por id (bootstrap). */
type Sel = { ids?: string[]; after?: string; take?: number };

const idWhere = (s: Sel) => (s.ids ? { id: { in: s.ids } } : s.after ? { id: { gt: s.after } } : {});
const page = (s: Sel) => ({ orderBy: { id: "asc" as const }, ...(s.take && { take: s.take }) });

/** Quita el costo de las partidas a quien no ve costos (igual que la web). */
function stripCost<T extends { unitCost?: unknown }>(user: CurrentUser, items: T[]) {
  return can(user, "products.write") ? items : items.map(({ unitCost: _c, ...rest }) => rest);
}

const loaders: Record<SyncEntity, (user: CurrentUser, s: Sel) => Promise<Row[]>> = {
  async Product(user, s) {
    if (!can(user, "products.read")) return [];
    const costs = can(user, "products.write");
    const rows = await db.product.findMany({
      where: idWhere(s), ...page(s),
      select: {
        id: true, sku: true, oemName: true, oemPartNumber: true, supplierCode: true, description: true, categoryId: true,
        line: true, kind: true, unit: true, currency: true, price: true, taxRate: true, status: true, searchText: true, updatedAt: true,
        cost: costs, markup: costs, shipping: costs, consumables: costs,
      },
    });
    return rows.map((r) => ({ id: r.id, data: r }));
  },

  async Customer(user, s) {
    if (!can(user, "customers.read")) return [];
    const rows = await db.customer.findMany({
      where: { AND: [idWhere(s), customerScope(user)] }, ...page(s),
      include: { contacts: { orderBy: { name: "asc" } }, addresses: { orderBy: { label: "asc" } } },
    });
    return rows.map((r) => ({ id: r.id, data: r }));
  },

  async Quote(user, s) {
    if (!can(user, "quotes.read_all") && !can(user, "quotes.read_own")) return [];
    const rows = await db.quote.findMany({
      where: { AND: [idWhere(s), quoteScope(user)] }, ...page(s),
      include: { items: { orderBy: { position: "asc" } }, customer: { select: { legalName: true } }, seller: { select: { name: true } }, sale: { select: { id: true, folio: true } } },
    });
    return rows.map(({ customer, seller, items, ...r }) => ({
      id: r.id, data: { ...r, customerName: customer.legalName, sellerName: seller.name, items: stripCost(user, items) },
    }));
  },

  async Sale(user, s) {
    if (!can(user, "sales.read_all") && !can(user, "sales.read_own")) return [];
    const rows = await db.sale.findMany({
      where: { AND: [idWhere(s), saleScope(user)] }, ...page(s),
      include: { items: { orderBy: { id: "asc" } }, payments: { orderBy: { paidAt: "asc" } }, customer: { select: { legalName: true } }, quote: { select: { folio: true } } },
    });
    return rows.map(({ customer, quote, items, ...r }) => ({
      id: r.id, data: { ...r, customerName: customer.legalName, quoteFolio: quote.folio, items: stripCost(user, items) },
    }));
  },

  async StockBalance(user, s) {
    if (!can(user, "inventory.read")) return [];
    const key = (id: string) => { const [productId = "", warehouseId = ""] = id.split(":"); return { productId, warehouseId }; };
    let where: Prisma.StockBalanceWhereInput = {};
    if (s.ids) where = s.ids.length ? { OR: s.ids.map(key) } : { productId: { in: [] } };
    else if (s.after) {
      const a = key(s.after);
      where = { OR: [{ productId: { gt: a.productId } }, { productId: a.productId, warehouseId: { gt: a.warehouseId } }] };
    }
    const rows = await db.stockBalance.findMany({ where, orderBy: [{ productId: "asc" }, { warehouseId: "asc" }], ...(s.take && { take: s.take }) });
    return rows.map((r) => ({ id: `${r.productId}:${r.warehouseId}`, data: { id: `${r.productId}:${r.warehouseId}`, ...r } }));
  },

  async Warehouse(_user, s) {
    const rows = await db.warehouse.findMany({ where: idWhere(s), ...page(s) });
    return rows.map((r) => ({ id: r.id, data: r }));
  },

  /** Solo el tipo de cambio vigente; los anteriores se mandan como baja. */
  async ExchangeRate(_user, s) {
    const latest = await db.exchangeRate.findFirst({ orderBy: { createdAt: "desc" } });
    if (!latest) return [];
    if (s.ids && !s.ids.includes(latest.id)) return [];
    if (s.after && latest.id <= s.after) return [];
    return [{ id: latest.id, data: latest }];
  },

  async ComplementPackage(user, s) {
    const where: Prisma.ComplementPackageWhereInput = { active: true, ...(!can(user, "complements.manage") && { shared: true }) };
    const rows = await db.complementPackage.findMany({ where: { AND: [idWhere(s), where] }, ...page(s) });
    return rows.map((r) => ({ id: r.id, data: r }));
  },
};

/** Filas visibles para el usuario de una entidad (por id). */
export async function loadVisible(user: CurrentUser, entity: SyncEntity, ids: string[]): Promise<Map<string, Record<string, unknown>>> {
  if (!ids.length) return new Map();
  // Los ids que no son UUID (salvo StockBalance) no existen: evitamos un error de Postgres.
  const valid = entity === "StockBalance" ? ids.filter((i) => /^[0-9a-f-]{36}:[0-9a-f-]{36}$/i.test(i)) : ids.filter((i) => /^[0-9a-f-]{36}$/i.test(i));
  const rows = await loaders[entity](user, { ids: valid });
  return new Map(rows.map((r) => [r.id, r.data]));
}

/** Fila JSON que guarda el teléfono, o null si no existe o el usuario no puede verla. */
export async function serializeEntity(user: CurrentUser, entity: SyncEntity, id: string) {
  return (await loadVisible(user, entity, [id])).get(id) ?? null;
}

export interface PulledChange { entity: SyncEntity; id: string; deleted: boolean; data: Record<string, unknown> | null }

/**
 * Cambios desde `cursor`, filtrados por scope. Una entidad que el usuario ya no ve
 * (reasignada, desactivada del catálogo compartido, borrada) llega como baja.
 */
export async function pull(user: CurrentUser, device: Device, cursor: bigint, limit = 500) {
  const take = Math.min(Math.max(limit, 1), 1000);
  const log = await db.syncChange.findMany({ where: { seq: { gt: cursor } }, orderBy: { seq: "asc" }, take });
  const last = new Map<string, { entity: SyncEntity; id: string; seq: bigint }>();
  for (const c of log) {
    if (!isSyncEntity(c.entity)) continue;
    const k = `${c.entity}|${c.entityId}`;
    last.delete(k); // reinsertar conserva el orden por el seq más alto
    last.set(k, { entity: c.entity, id: c.entityId, seq: c.seq });
  }
  const byEntity = new Map<SyncEntity, string[]>();
  for (const v of last.values()) byEntity.set(v.entity, [...(byEntity.get(v.entity) ?? []), v.id]);
  const visible = new Map<SyncEntity, Map<string, Record<string, unknown>>>();
  for (const [entity, ids] of byEntity) visible.set(entity, await loadVisible(user, entity, ids));

  const changes: PulledChange[] = [...last.values()].map(({ entity, id }) => {
    const data = visible.get(entity)?.get(id) ?? null;
    return { entity, id, deleted: !data, data };
  });
  const next = log.length ? log[log.length - 1]!.seq : cursor;
  if (next > device.lastPullSeq) await db.device.update({ where: { id: device.id }, data: { lastPullSeq: next } });
  return { changes, cursor: next, hasMore: log.length === take };
}

/** Primera descarga paginada por entidad (ordenada por id) de lo que el usuario puede ver. */
export async function bootstrapPage(user: CurrentUser, entity: string, after: string | undefined, limit = 1000) {
  if (!isSyncEntity(entity)) throw new AppError("Entidad desconocida.", "VALIDATION");
  const take = Math.min(Math.max(limit, 1), 2000);
  if (after && !(entity === "StockBalance" ? /^[0-9a-f-]{36}:[0-9a-f-]{36}$/i : /^[0-9a-f-]{36}$/i).test(after))
    throw new AppError("Cursor inválido.", "VALIDATION");
  const rows = await loaders[entity](user, { after, take });
  return { entity, items: rows.map((r) => r.data), next: rows.length === take ? rows[rows.length - 1]!.id : null };
}

export function parseCursor(v: string | null): bigint {
  if (!v) return BigInt(0);
  if (!/^\d{1,19}$/.test(v)) throw new AppError("Cursor inválido.", "VALIDATION");
  return BigInt(v);
}
