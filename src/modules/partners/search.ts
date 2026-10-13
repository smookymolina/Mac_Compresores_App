import "server-only";
import type { Currency } from "@prisma/client";
import { db } from "@/lib/db";
import type { Dec } from "@/lib/money";
import { searchKey } from "@/lib/search-text";
import { effectiveDiscount, getPartnerPrice, getPartnerSettings } from "./pricing";

/** Única forma del producto que el portal conoce: sin datos internos (margen, existencias, proveedores). */
export interface PartnerProductRow {
  id: string;
  sku: string;
  description: string;
  unit: string;
  currency: Currency;
  /** Precio de lista; solo para cálculo en servidor, nunca se serializa al cliente. */
  price: Dec;
}

export const PARTNER_SEARCH_MIN = 3;
export const PARTNER_SEARCH_MAX = 60;
export const PARTNER_SEARCH_TAKE = 20;

/** Normaliza el término y quita los comodines de LIKE (% _ \) para que no sirvan de «traer todo». */
export function cleanSearchTerm(raw: string): string {
  return searchKey(raw.slice(0, PARTNER_SEARCH_MAX * 2)).replace(/[%_\\]/g, "").slice(0, PARTNER_SEARCH_MAX).trim();
}

/** Búsqueda de productos activos con precio > 0. `select` explícito: nunca devuelve el modelo completo. */
export async function searchPartnerProducts(q: string): Promise<PartnerProductRow[]> {
  const term = cleanSearchTerm(q);
  if (term.length < PARTNER_SEARCH_MIN) return [];
  return db.product.findMany({
    where: { status: "ACTIVE", price: { gt: 0 }, searchText: { contains: term } },
    select: { id: true, sku: true, description: true, unit: true, currency: true, price: true },
    orderBy: { sku: "asc" },
    take: PARTNER_SEARCH_TAKE,
  });
}

/** Precio del producto para el socio (para el PNG firmado). null si no existe, no está activo o no tiene precio. */
export async function getPartnerPriceForProduct(
  productId: string,
  partner: { discountPct: Dec | null },
): Promise<{ price: Dec; listPrice: Dec; pct: Dec; currency: Currency } | null> {
  const p = await db.product.findFirst({
    where: { id: productId, status: "ACTIVE", price: { gt: 0 } },
    select: { currency: true, price: true },
  });
  if (!p) return null;
  const settings = await getPartnerSettings();
  const pct = effectiveDiscount(partner, settings);
  return { price: getPartnerPrice(p.price, pct), listPrice: p.price, pct, currency: p.currency };
}
