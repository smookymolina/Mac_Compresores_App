import type { Currency, ProductKind, ProductLine, ProductStatus } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { computeLine, dec, round2, sumLines, toMxn, type Dec, type LineAmounts } from "@/lib/money";

export interface CatalogProduct {
  id: string;
  sku: string;
  description: string;
  line: ProductLine;
  kind: ProductKind;
  unit: string;
  cost: Dec;
  shipping?: Dec;
  consumables?: Dec;
  currency?: Currency;
  price: Dec;
  taxRate: Dec;
  status: ProductStatus;
}

export interface RequestedItem {
  productId: string;
  quantity: string;
  discountPct: string; // fracción
  unitPrice?: string; // MXN; solo con permiso de sobrescritura
  details?: string; // actividades/alcance del servicio
}

export interface ItemSnapshot extends LineAmounts {
  productId: string;
  position: number;
  sku: string;
  description: string;
  line: ProductLine;
  kind: ProductKind;
  unit: string;
  quantity: Dec;
  unitPrice: Dec;
  unitCost: Dec;
  discountPct: Dec;
  taxRate: Dec;
  details: string | null;
  origCurrency: Currency;
  origUnitPrice: Dec;
  fxRate: Dec;
}

/** Precio de lista en MXN (convierte productos en USD, p. ej. tubería, con el TC dado). */
export function catalogPriceMxn(p: Pick<CatalogProduct, "price" | "currency">, fx: Dec | null | undefined): Dec {
  if (p.currency === "USD" && !fx) throw new AppError("Captura el tipo de cambio USD antes de cotizar productos en dólares.");
  return round2(toMxn(p.price, p.currency ?? "MXN", fx ?? 1));
}

/**
 * Construye la instantánea de cada partida tomando precio, costo e impuesto del catálogo
 * en el servidor. El cliente nunca fija el precio salvo con permiso explícito.
 */
export function buildItemSnapshots(
  requested: RequestedItem[],
  catalog: Map<string, CatalogProduct>,
  opts: { canOverridePrice: boolean; fx?: Dec | null },
): { items: ItemSnapshot[]; totals: ReturnType<typeof sumLines> } {
  if (requested.length === 0) throw new AppError("La cotización necesita al menos una partida.");

  const items = requested.map((r, idx): ItemSnapshot => {
    const p = catalog.get(r.productId);
    if (!p) throw new AppError(`Partida ${idx + 1}: producto no encontrado.`);
    if (p.status !== "ACTIVE") throw new AppError(`Partida ${idx + 1}: ${p.sku} está inactivo.`);

    const quantity = dec(r.quantity);
    if (quantity.lte(0)) throw new AppError(`Partida ${idx + 1}: la cantidad debe ser mayor a 0.`);

    const discountPct = dec(r.discountPct);
    if (discountPct.lt(0) || discountPct.gte(1)) throw new AppError(`Partida ${idx + 1}: descuento inválido.`);
    // Sin tope por rol: el descuento de quien no es administrador lo autoriza un administrador (v1.3.20).

    const currency = p.currency ?? "MXN";
    const fx = currency === "USD" ? (opts.fx ?? null) : null;
    const listMxn = catalogPriceMxn(p, fx);
    let unitPrice = listMxn;
    if (r.unitPrice !== undefined && r.unitPrice !== "" && !dec(r.unitPrice).eq(listMxn)) {
      if (!opts.canOverridePrice) throw new AppError(`Partida ${idx + 1}: no puedes modificar el precio de lista.`);
      unitPrice = dec(r.unitPrice);
    }
    if (unitPrice.lte(0)) {
      throw new AppError(`Partida ${idx + 1}: ${p.sku} no tiene precio de venta; solicita precio a gerencia.`);
    }

    const amounts = computeLine({ quantity, unitPrice, discountPct, taxRate: p.taxRate });
    return {
      productId: p.id,
      position: idx + 1,
      sku: p.sku,
      description: p.description,
      line: p.line,
      kind: p.kind,
      unit: p.unit,
      quantity,
      unitPrice,
      // Costo total por unidad (base + traslado + consumibles) en MXN: utilidad neta después de gastos.
      unitCost: toMxn(p.cost.add(p.shipping ?? 0).add(p.consumables ?? 0), currency, fx ?? 1).toDecimalPlaces(4),
      discountPct,
      taxRate: p.taxRate,
      details: r.details?.trim() || null,
      origCurrency: currency,
      origUnitPrice: p.price,
      fxRate: fx ?? dec(1),
      ...amounts,
    };
  });

  return { items, totals: sumLines(items) };
}
