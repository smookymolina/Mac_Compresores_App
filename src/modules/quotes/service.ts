import type { Prisma, QuoteStatus } from "@prisma/client";
import type { QuoteComplement } from "@/modules/complements/match";
import { db } from "@/lib/db";
import { pageArgs, paged } from "@/lib/pagination";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { customerScope } from "@/modules/customers/service";
import { buildItemSnapshots, type RequestedItem } from "./pricing";
import { currentExchangeRate } from "@/modules/products/service";
import type { QuoteCurrency } from "./currency";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { fmtMoney, fmtPct } from "@/lib/money";
import { QUOTE_STATUS_LABEL, canTransition } from "./status";

export function quoteScope(user: CurrentUser): Prisma.QuoteWhereInput {
  return can(user, "quotes.read_all") ? {} : { sellerId: user.id };
}

export async function listQuotes(user: CurrentUser, q: { status?: QuoteStatus; search?: string; page?: number }) {
  const folio = q.search && /^\d+$/.test(q.search) ? Number(q.search) : undefined;
  const { page, skip, take } = pageArgs(q.page);
  const where: Prisma.QuoteWhereInput = {
    AND: [
      quoteScope(user),
      q.status ? { status: q.status } : {},
      q.search
        ? { OR: [{ customer: { legalName: { contains: q.search, mode: "insensitive" } } }, ...(folio ? [{ folio }] : [])] }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    db.quote.findMany({
      where,
      include: { customer: { select: { legalName: true } }, seller: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      skip,
      take,
    }),
    db.quote.count({ where }),
  ]);
  return paged(items, total, page);
}

export async function getQuote(user: CurrentUser, id: string) {
  const quote = await db.quote.findFirst({
    where: { AND: [{ id }, quoteScope(user)] },
    include: {
      customer: { include: { addresses: true, contacts: true } },
      seller: { select: { id: true, name: true, email: true, signatureHtml: true } },
      discountDecidedBy: { select: { name: true } },
      items: { orderBy: { position: "asc" } },
      sale: { select: { id: true, folio: true } },
    },
  });
  if (!quote) throw new AppError("Cotización no encontrada.", "NOT_FOUND");
  return quote;
}

export interface QuoteInput {
  customerId: string;
  validUntil: Date;
  notes?: string;
  deliveryTime?: string;
  warrantyMonths?: number;
  complements?: QuoteComplement[];
  currency?: QuoteCurrency;
  /** Vendedor asignado; solo quien tiene `quotes.assign_seller` (Administrador) puede elegir otro. */
  sellerId?: string;
  /** Motivo del descuento para el administrador que lo autoriza. */
  discountNote?: string;
  items: RequestedItem[];
}

/** Vendedor de la cotización: el propio usuario, salvo que un administrador asigne a otro. */
async function resolveSeller(user: CurrentUser, requested: string | undefined, current?: string) {
  const fallback = current ?? user.id;
  if (!requested || requested === fallback) return fallback;
  if (!can(user, "quotes.assign_seller")) {
    throw new AppError("Solo un administrador puede asignar la cotización a otro vendedor.", "FORBIDDEN");
  }
  const ok = (await usersWithPermission("quotes.write")).some((u) => u.id === requested);
  if (!ok) throw new AppError("El vendedor elegido no está activo o no puede cotizar.");
  return requested;
}

/** Vendedores que un administrador puede asignar; incluye al actual aunque ya no esté activo. */
export async function sellerOptions(current?: { id: string; name: string }) {
  const list = (await usersWithPermission("quotes.write")).map(({ id, name }) => ({ id, name }));
  if (current && !list.some((u) => u.id === current.id)) list.push(current);
  return list.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

type Snap = Awaited<ReturnType<typeof snapshots>>;
type DiscountState = { discountStatus: "NONE" | "PENDING" | "APPROVED"; discountDecidedById: string | null; discountDecidedAt: Date | null };

/** Firma del descuento para saber si cambió respecto a lo ya autorizado. */
function discountSig(items: { productId: string | null; discountPct: { toString(): string } }[], total: { toString(): string }) {
  return JSON.stringify([items.map((i) => [i.productId, Number(i.discountPct.toString())]), Number(total.toString())]);
}

/**
 * Sin descuento → NONE. Un administrador lo autoriza al guardarlo.
 * Otro rol → PENDING, salvo que el descuento sea idéntico al ya autorizado.
 */
function discountState(user: CurrentUser, snap: Snap, prev?: { discountStatus: string; discountDecidedById: string | null; discountDecidedAt: Date | null; sig: string }): DiscountState {
  if (snap.totals.discountTotal.isZero()) return { discountStatus: "NONE", discountDecidedById: null, discountDecidedAt: null };
  if (can(user, "quotes.approve_discount")) return { discountStatus: "APPROVED", discountDecidedById: user.id, discountDecidedAt: new Date() };
  if (prev?.discountStatus === "APPROVED" && prev.sig === discountSig(snap.items, snap.totals.discountTotal)) {
    return { discountStatus: "APPROVED", discountDecidedById: prev.discountDecidedById, discountDecidedAt: prev.discountDecidedAt };
  }
  return { discountStatus: "PENDING", discountDecidedById: null, discountDecidedAt: null };
}

/** Avisa a todos los administradores que hay un descuento por autorizar. */
async function requestDiscountApproval(user: CurrentUser, quoteId: string) {
  const q = await db.quote.findUniqueOrThrow({ where: { id: quoteId }, include: { customer: { select: { legalName: true } }, items: { select: { discountPct: true } } } });
  const pcts = [...new Set(q.items.filter((i) => !i.discountPct.isZero()).map((i) => fmtPct(i.discountPct)))];
  const admins = (await usersWithPermission("quotes.approve_discount")).map((u) => u.id).filter((id) => id !== user.id);
  await notify(admins, {
    kind: "quote.discount_request",
    title: `C-${q.folio}: descuento por autorizar`,
    body: `${user.name} pide ${pcts.join(", ")} de descuento (-${fmtMoney(q.discountTotal)}) para ${q.customer.legalName}.${q.discountNote ? ` Motivo: ${q.discountNote}` : ""}`,
    href: `/cotizaciones/${q.id}`,
  });
}

/** Mientras el descuento no esté autorizado, la cotización no sale al cliente. */
export function assertDiscountCleared(quote: { discountStatus: string }) {
  if (quote.discountStatus === "PENDING") {
    throw new AppError("El descuento espera la autorización de un administrador. Podrás enviarla cuando lo autorice.", "CONFLICT");
  }
  if (quote.discountStatus === "REJECTED") {
    throw new AppError("Un administrador rechazó el descuento. Edita la cotización para cambiarlo o quitarlo.", "CONFLICT");
  }
}

async function snapshots(user: CurrentUser, items: RequestedItem[], currency: QuoteCurrency = "MXN") {
  const products = await db.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  const usesUsd = currency === "USD" || products.some((p) => p.currency === "USD");
  const fx = usesUsd ? ((await currentExchangeRate())?.rate ?? null) : null;
  if (currency === "USD" && !fx) throw new AppError("Captura el tipo de cambio USD antes de cotizar en dólares.");
  const res = buildItemSnapshots(items, new Map(products.map((p) => [p.id, p])), {
    canOverridePrice: can(user, "quotes.override_price"),
    fx,
  });
  return { ...res, exchangeRate: fx };
}

function itemRows(items: Awaited<ReturnType<typeof snapshots>>["items"]) {
  return items.map((i) => ({
    productId: i.productId, position: i.position, sku: i.sku, description: i.description,
    line: i.line, kind: i.kind, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice,
    unitCost: i.unitCost, discountPct: i.discountPct, taxRate: i.taxRate,
    subtotal: i.subtotal, discount: i.discount, tax: i.tax, total: i.total,
    details: i.details, origCurrency: i.origCurrency, origUnitPrice: i.origUnitPrice, fxRate: i.fxRate,
  }));
}

export async function createQuote(user: CurrentUser, input: QuoteInput) {
  const customer = await db.customer.findFirst({ where: { AND: [{ id: input.customerId }, customerScope(user)] } });
  if (!customer) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
  const sellerId = await resolveSeller(user, input.sellerId);
  const snap = await snapshots(user, input.items, input.currency);
  const { items, totals, exchangeRate } = snap;
  const disc = discountState(user, snap);

  const quote = await db.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        customerId: customer.id,
        sellerId,
        ...disc,
        discountNote: disc.discountStatus === "NONE" ? null : input.discountNote || null,
        validUntil: input.validUntil,
        notes: input.notes || null,
        deliveryTime: input.deliveryTime || null,
        warrantyMonths: input.warrantyMonths ?? null,
        complements: input.complements as unknown as Prisma.InputJsonValue | undefined,
        currency: input.currency ?? "MXN",
        exchangeRate,
        ...totals,
        items: { create: itemRows(items) },
      },
    });
    await audit({ userId: user.id, action: "quote.create", entity: "Quote", entityId: quote.id,
      data: { folio: quote.folio, total: totals.total.toString(), ...(sellerId !== user.id ? { sellerId } : {}), discount: disc.discountStatus } }, tx);
    return quote;
  });
  if (disc.discountStatus === "PENDING") await requestDiscountApproval(user, quote.id);
  if (sellerId !== user.id) await notifyAssigned(user, sellerId, quote.id, quote.folio);
  return quote;
}

async function notifyAssigned(user: CurrentUser, sellerId: string, id: string, folio: number) {
  await notify([sellerId], {
    kind: "quote.assigned", title: `C-${folio}: te asignaron una cotización`,
    body: `${user.name} te asignó la cotización.`, href: `/cotizaciones/${id}`,
  });
}

/** Solo borradores son editables; las partidas se reemplazan con nuevas instantáneas. */
export async function updateQuote(user: CurrentUser, id: string, input: QuoteInput) {
  const current = await getQuote(user, id);
  if (current.status !== "DRAFT") throw new AppError("Solo se pueden editar cotizaciones en borrador.", "CONFLICT");
  const customer = await db.customer.findFirst({ where: { AND: [{ id: input.customerId }, customerScope(user)] } });
  if (!customer) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
  const sellerId = await resolveSeller(user, input.sellerId, current.seller.id);
  const snap = await snapshots(user, input.items, input.currency);
  const { items, totals, exchangeRate } = snap;
  const disc = discountState(user, snap, { ...current, sig: discountSig(current.items, current.discountTotal) });

  await db.$transaction(async (tx) => {
    const res = await tx.quote.updateMany({
      where: { id, status: "DRAFT", updatedAt: current.updatedAt }, // bloqueo optimista
      data: { customerId: customer.id, sellerId, ...disc,
        discountNote: disc.discountStatus === "NONE" ? null : input.discountNote || null, validUntil: input.validUntil, notes: input.notes || null, deliveryTime: input.deliveryTime || null,
        warrantyMonths: input.warrantyMonths ?? null,
        complements: input.complements as unknown as Prisma.InputJsonValue | undefined,
        currency: input.currency ?? "MXN", exchangeRate, ...totals },
    });
    if (res.count === 0) throw new AppError("La cotización cambió mientras la editabas. Recarga.", "CONFLICT");
    await tx.quoteItem.deleteMany({ where: { quoteId: id } });
    await tx.quoteItem.createMany({ data: itemRows(items).map((r) => ({ ...r, quoteId: id })) });
    await audit({ userId: user.id, action: "quote.update", entity: "Quote", entityId: id,
      data: { total: totals.total.toString(), ...(sellerId !== current.seller.id ? { sellerId } : {}), discount: disc.discountStatus } }, tx);
  });
  if (disc.discountStatus === "PENDING") await requestDiscountApproval(user, id);
  if (sellerId !== current.seller.id && sellerId !== user.id) await notifyAssigned(user, sellerId, id, current.folio);
}

/**
 * Un administrador autoriza o rechaza el descuento. Basta uno; el primero que decide gana.
 * Todos los administradores y el vendedor reciben el aviso de quién decidió.
 */
export async function decideDiscount(user: CurrentUser, id: string, approve: boolean, comment?: string) {
  if (!can(user, "quotes.approve_discount")) throw new AppError("Solo un administrador puede autorizar descuentos.", "FORBIDDEN");
  const q = await getQuote(user, id);
  if (q.discountStatus !== "PENDING") {
    throw new AppError(q.discountStatus === "APPROVED" || q.discountStatus === "REJECTED"
      ? "Otro administrador ya decidió este descuento. Recarga para verlo." : "Esta cotización no tiene un descuento pendiente.", "CONFLICT");
  }
  const to = approve ? "APPROVED" : "REJECTED";
  await db.$transaction(async (tx) => {
    const res = await tx.quote.updateMany({
      where: { id, discountStatus: "PENDING", updatedAt: q.updatedAt },
      data: { discountStatus: to, discountDecidedById: user.id, discountDecidedAt: new Date() },
    });
    if (res.count === 0) throw new AppError("La cotización cambió o ya se decidió. Recarga.", "CONFLICT");
    await tx.approval.create({ data: { entityType: "Quote", entityId: id, action: approve ? "discount.approve" : "discount.reject", decidedById: user.id, comment: comment || null } });
    await audit({ userId: user.id, action: approve ? "quote.discount_approve" : "quote.discount_reject", entity: "Quote", entityId: id,
      data: { folio: q.folio, discount: q.discountTotal.toString(), comment: comment || undefined } }, tx);
  });
  const verb = approve ? "autorizó" : "rechazó";
  const admins = (await usersWithPermission("quotes.approve_discount")).map((u) => u.id);
  await notify([...admins, q.seller.id].filter((uid) => uid !== user.id), {
    kind: approve ? "quote.discount_approved" : "quote.discount_rejected",
    title: `C-${q.folio}: descuento ${approve ? "autorizado" : "rechazado"} por ${user.name}`,
    body: `${user.name} ${verb} el descuento de -${fmtMoney(q.discountTotal)} para ${q.customer.legalName} (vendedor: ${q.seller.name}).${comment ? ` Comentario: ${comment}` : ""}`,
    href: `/cotizaciones/${id}`,
  });
}

export async function changeQuoteStatus(user: CurrentUser, id: string, to: QuoteStatus) {
  const quote = await getQuote(user, id);
  if (!canTransition(quote.status, to)) {
    throw new AppError(`No se puede pasar de ${quote.status} a ${to}.`, "CONFLICT");
  }
  if (to !== "CANCELLED") assertDiscountCleared(quote);
  if (to === "ACCEPTED" && quote.validUntil < startOfToday()) {
    throw new AppError("La cotización está vencida; no puede aceptarse.", "CONFLICT");
  }
  await db.$transaction(async (tx) => {
    const res = await tx.quote.updateMany({ where: { id, status: quote.status }, data: { status: to } });
    if (res.count === 0) throw new AppError("La cotización cambió de estado. Recarga.", "CONFLICT");
    await audit({ userId: user.id, action: "quote.status", entity: "Quote", entityId: id,
      data: { from: quote.status, to } }, tx);
  });
  // Si otra persona movió la cotización, el vendedor se entera.
  if (quote.seller.id !== user.id) {
    await notify([quote.seller.id], {
      kind: "quote.status", title: `C-${quote.folio}: ${QUOTE_STATUS_LABEL[to]}`,
      body: `${user.name} cambió el estado de la cotización.`, href: `/cotizaciones/${id}`,
    });
  }
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Eliminación definitiva de una cotización. Solo el rol con `quotes.delete` (Administrador). */
export async function deleteQuote(user: CurrentUser, id: string) {
  if (!can(user, "quotes.delete")) throw new AppError("No tienes permiso para eliminar cotizaciones.", "FORBIDDEN");
  const quote = await getQuote(user, id);
  if (quote.status === "CONVERTED" || quote.sale) {
    throw new AppError("Una cotización convertida en venta no se puede eliminar. Cancélala en su lugar.", "CONFLICT");
  }
  await db.$transaction(async (tx) => {
    await tx.quoteItem.deleteMany({ where: { quoteId: id } });
    await tx.quote.delete({ where: { id } });
    await audit({ userId: user.id, action: "quote.delete", entity: "Quote", entityId: id,
      data: { folio: quote.folio, status: quote.status, total: quote.total.toString() } }, tx);
  });
}
