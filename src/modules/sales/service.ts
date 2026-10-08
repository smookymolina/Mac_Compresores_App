import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { quoteScope } from "@/modules/quotes/service";
import { applyMovement } from "@/modules/inventory/service";

export function saleScope(user: CurrentUser): Prisma.SaleWhereInput {
  return can(user, "sales.read_all") ? {} : { sellerId: user.id };
}

export async function listSales(user: CurrentUser) {
  return db.sale.findMany({
    where: saleScope(user),
    include: { customer: { select: { legalName: true } }, seller: { select: { name: true } }, quote: { select: { folio: true } } },
    orderBy: { confirmedAt: "desc" },
    take: 200,
  });
}

export async function getSale(user: CurrentUser, id: string) {
  const sale = await db.sale.findFirst({
    where: { AND: [{ id }, saleScope(user)] },
    include: {
      customer: true, seller: { select: { name: true } }, warehouse: true,
      quote: { select: { id: true, folio: true } }, items: true,
    },
  });
  if (!sale) throw new AppError("Venta no encontrada.", "NOT_FOUND");
  return sale;
}

/**
 * Convierte una cotización ACEPTADA en venta, en una sola transacción:
 * marca la cotización (guardia de estado), copia la instantánea y descuenta inventario.
 * Doble procesamiento: lo impiden el UPDATE condicionado y la unicidad Sale.quoteId.
 */
export async function convertQuoteToSale(user: CurrentUser, quoteId: string, warehouseId: string) {
  const quote = await db.quote.findFirst({
    where: { AND: [{ id: quoteId }, quoteScope(user)] },
    include: { items: true },
  });
  if (!quote) throw new AppError("Cotización no encontrada.", "NOT_FOUND");
  if (quote.status !== "ACCEPTED") throw new AppError("Solo cotizaciones aceptadas pueden convertirse en venta.", "CONFLICT");
  const wh = await db.warehouse.findFirst({ where: { id: warehouseId, active: true } });
  if (!wh) throw new AppError("Almacén inválido.");

  try {
    return await db.$transaction(async (tx) => {
      const guard = await tx.quote.updateMany({ where: { id: quoteId, status: "ACCEPTED" }, data: { status: "CONVERTED" } });
      if (guard.count === 0) throw new AppError("La cotización ya fue procesada.", "CONFLICT");

      const sale = await tx.sale.create({
        data: {
          quoteId, customerId: quote.customerId, sellerId: quote.sellerId, warehouseId, createdById: user.id,
          subtotal: quote.subtotal, discountTotal: quote.discountTotal, taxTotal: quote.taxTotal, total: quote.total,
          items: {
            create: quote.items.map((i) => ({
              productId: i.productId, sku: i.sku, description: i.description, line: i.line, kind: i.kind,
              unit: i.unit, quantity: i.quantity, unitPrice: i.unitPrice, unitCost: i.unitCost,
              discountPct: i.discountPct, taxRate: i.taxRate, subtotal: i.subtotal, discount: i.discount,
              tax: i.tax, total: i.total,
            })),
          },
        },
      });

      for (const i of quote.items) {
        if (i.kind !== "PRODUCT" || !i.productId) continue;
        await applyMovement(tx, {
          productId: i.productId, warehouseId, type: "SALE_OUT", quantity: i.quantity.neg(),
          reason: `Venta #${sale.folio}`, userId: user.id, refType: "SALE", refId: sale.id,
        });
      }
      await audit({ userId: user.id, action: "sale.confirm", entity: "Sale", entityId: sale.id,
        data: { quoteFolio: quote.folio, total: quote.total.toString() } }, tx);
      return sale;
    });
  } catch (e) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      throw new AppError("La cotización ya fue convertida en venta.", "CONFLICT");
    }
    throw e;
  }
}

/** Cancela una venta y repone inventario con movimientos compensatorios. */
export async function cancelSale(user: CurrentUser, saleId: string, reason: string) {
  const sale = await getSale(user, saleId);
  const locked = await db.commissionEntry.count({
    where: {
      sellerId: sale.sellerId, status: { in: ["APPROVED", "PAID"] },
      period: { startDate: { lte: sale.confirmedAt }, endDate: { gte: sale.confirmedAt } },
    },
  });
  if (locked > 0) throw new AppError("La venta pertenece a un periodo con comisiones aprobadas.", "CONFLICT");

  await db.$transaction(async (tx) => {
    const guard = await tx.sale.updateMany({ where: { id: saleId, status: "CONFIRMED" }, data: { status: "CANCELLED" } });
    if (guard.count === 0) throw new AppError("La venta ya está cancelada.", "CONFLICT");
    const outs = await tx.inventoryMovement.findMany({ where: { refType: "SALE", refId: saleId, type: "SALE_OUT" } });
    for (const m of outs) {
      await applyMovement(tx, {
        productId: m.productId, warehouseId: m.warehouseId, type: "REVERSAL", quantity: m.quantity.neg(),
        reason: `Cancelación venta #${sale.folio}: ${reason}`, userId: user.id, reversesId: m.id,
        refType: "SALE", refId: saleId,
      });
    }
    await audit({ userId: user.id, action: "sale.cancel", entity: "Sale", entityId: saleId, data: { reason } }, tx);
  });
}
