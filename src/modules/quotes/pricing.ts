import type { ProductKind, ProductLine, ProductStatus } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { computeLine, dec, sumLines, type Dec, type LineAmounts } from "@/lib/money";
import { MAX_DISCOUNT_WITHOUT_OVERRIDE } from "@/lib/auth/permissions";

export interface CatalogProduct {
  id: string;
  sku: string;
  description: string;
  line: ProductLine;
  kind: ProductKind;
  unit: string;
  cost: Dec;
  price: Dec;
  taxRate: Dec;
  status: ProductStatus;
}

export interface RequestedItem {
  productId: string;
  quantity: string;
  discountPct: string; // fracción
  unitPrice?: string; // solo con permiso de sobrescritura
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
}

/**
 * Construye la instantánea de cada partida tomando precio, costo e impuesto del catálogo
 * en el servidor. El cliente nunca fija el precio salvo con permiso explícito.
 */
export function buildItemSnapshots(
  requested: RequestedItem[],
  catalog: Map<string, CatalogProduct>,
  opts: { canOverridePrice: boolean },
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
    if (!opts.canOverridePrice && discountPct.gt(MAX_DISCOUNT_WITHOUT_OVERRIDE)) {
      throw new AppError(
        `Partida ${idx + 1}: el descuento máximo permitido es ${MAX_DISCOUNT_WITHOUT_OVERRIDE * 100}%.`,
      );
    }

    let unitPrice = p.price;
    if (r.unitPrice !== undefined && r.unitPrice !== "" && !dec(r.unitPrice).eq(p.price)) {
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
      unitCost: p.cost,
      discountPct,
      taxRate: p.taxRate,
      ...amounts,
    };
  });

  return { items, totals: sumLines(items) };
}
