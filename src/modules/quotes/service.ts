import type { Prisma, QuoteStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { pageArgs, paged } from "@/lib/pagination";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { customerScope } from "@/modules/customers/service";
import { buildItemSnapshots, type RequestedItem } from "./pricing";
import { notify } from "@/modules/notifications/service";
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
      seller: { select: { id: true, name: true, email: true } },
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
  items: RequestedItem[];
}

async function snapshots(user: CurrentUser, items: RequestedItem[]) {
  const products = await db.product.findMany({ where: { id: { in: items.map((i) => i.productId) } } });
  return buildItemSnapshots(items, new Map(products.map((p) => [p.id, p])), {
    canOverridePrice: can(user, "quotes.override_price"),
  });
}

function itemRows(items: Awaited<ReturnType<typeof snapshots>>["items"]) {
  return items.map((i) => ({
    productId: i.productId, position: i.position, sku: i.sku, description: i.description,
    line: i.line, kind: i.kind, unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice,
    unitCost: i.unitCost, discountPct: i.discountPct, taxRate: i.taxRate,
    subtotal: i.subtotal, discount: i.discount, tax: i.tax, total: i.total,
  }));
}

export async function createQuote(user: CurrentUser, input: QuoteInput) {
  const customer = await db.customer.findFirst({ where: { AND: [{ id: input.customerId }, customerScope(user)] } });
  if (!customer) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
  const { items, totals } = await snapshots(user, input.items);

  return db.$transaction(async (tx) => {
    const quote = await tx.quote.create({
      data: {
        customerId: customer.id,
        sellerId: user.id,
        validUntil: input.validUntil,
        notes: input.notes || null,
        ...totals,
        items: { create: itemRows(items) },
      },
    });
    await audit({ userId: user.id, action: "quote.create", entity: "Quote", entityId: quote.id,
      data: { folio: quote.folio, total: totals.total.toString() } }, tx);
    return quote;
  });
}

/** Solo borradores son editables; las partidas se reemplazan con nuevas instantáneas. */
export async function updateQuote(user: CurrentUser, id: string, input: QuoteInput) {
  const current = await getQuote(user, id);
  if (current.status !== "DRAFT") throw new AppError("Solo se pueden editar cotizaciones en borrador.", "CONFLICT");
  const customer = await db.customer.findFirst({ where: { AND: [{ id: input.customerId }, customerScope(user)] } });
  if (!customer) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
  const { items, totals } = await snapshots(user, input.items);

  return db.$transaction(async (tx) => {
    const res = await tx.quote.updateMany({
      where: { id, status: "DRAFT", updatedAt: current.updatedAt }, // bloqueo optimista
      data: { customerId: customer.id, validUntil: input.validUntil, notes: input.notes || null, ...totals },
    });
    if (res.count === 0) throw new AppError("La cotización cambió mientras la editabas. Recarga.", "CONFLICT");
    await tx.quoteItem.deleteMany({ where: { quoteId: id } });
    await tx.quoteItem.createMany({ data: itemRows(items).map((r) => ({ ...r, quoteId: id })) });
    await audit({ userId: user.id, action: "quote.update", entity: "Quote", entityId: id,
      data: { total: totals.total.toString() } }, tx);
  });
}

export async function changeQuoteStatus(user: CurrentUser, id: string, to: QuoteStatus) {
  const quote = await getQuote(user, id);
  if (!canTransition(quote.status, to)) {
    throw new AppError(`No se puede pasar de ${quote.status} a ${to}.`, "CONFLICT");
  }
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
