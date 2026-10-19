import { presentQuote } from "./currency";
import { dec, type DecInput } from "./money";
import type { QuoteComplement } from "./complements";
import type { QuotePdfData } from "./quote-pdf";

/**
 * Mapeo ÚNICO cotización → datos del PDF, compartido por la web (`modules/quotes/pdf.ts`, filas de Prisma)
 * y la app móvil (filas JSON de `/api/sync/pull`: decimales como string, fechas ISO).
 */

type Num = DecInput;

export interface PlainQuoteItem {
  sku: string;
  description: string;
  details?: string | null;
  quantity: Num;
  unitPrice: Num;
  discountPct: Num;
  taxRate: Num;
  origCurrency: string;
  origUnitPrice?: Num | null;
  fxRate?: Num | null;
  subtotal: Num;
  discount: Num;
  tax: Num;
  total: Num;
}

/** Forma plana de Quote (la que serializa `src/modules/sync/pull.ts`; también acepta Prisma.Decimal/Date). */
export interface PlainQuote {
  /** null = sin folio definitivo (usar `opts.folioLabel`). */
  folio: number | string | null;
  currency: string;
  exchangeRate?: Num | null;
  createdAt: Date | string;
  validUntil: Date | string;
  deliveryTime?: string | null;
  warrantyMonths?: number | null;
  notes?: string | null;
  complements?: unknown;
  items: PlainQuoteItem[];
  subtotal: Num;
  discountTotal: Num;
  taxTotal: Num;
  total: Num;
  /** Del pull (`customer.legalName`); se usa si no se pasa `opts.customer`. */
  customerName?: string | null;
}

export interface QuotePdfDataOptions {
  bankInfo: string[];
  customer?: { legalName: string; rfc?: string | null; contactName?: string | null };
  /** Etiqueta de folio en lugar de `C-<folio>` (p. ej. folio provisional del teléfono). */
  folioLabel?: string;
  /** Marca «Folio provisional» en el encabezado. */
  provisional?: boolean;
}

const optDec = (v: Num | null | undefined) => (v === null || v === undefined || v === "" ? null : dec(v));

export function toQuotePdfData(raw: PlainQuote, opts: QuotePdfDataOptions): QuotePdfData {
  const q = presentQuote({
    currency: raw.currency,
    exchangeRate: optDec(raw.exchangeRate),
    subtotal: dec(raw.subtotal), discountTotal: dec(raw.discountTotal), taxTotal: dec(raw.taxTotal), total: dec(raw.total),
    items: raw.items.map((i) => ({
      sku: i.sku, description: i.description, details: i.details ?? null, origCurrency: i.origCurrency,
      quantity: dec(i.quantity), unitPrice: dec(i.unitPrice), discountPct: dec(i.discountPct), taxRate: dec(i.taxRate),
      origUnitPrice: optDec(i.origUnitPrice), fxRate: optDec(i.fxRate) ?? dec(1),
      subtotal: dec(i.subtotal), discount: dec(i.discount), tax: dec(i.tax), total: dec(i.total),
    })),
  });
  const c = opts.customer ?? { legalName: raw.customerName ?? "—" };
  return {
    folio: raw.folio ?? "",
    ...(opts.folioLabel !== undefined && { folioLabel: opts.folioLabel }),
    ...(opts.provisional && { provisional: true }),
    currency: q.currency,
    exchangeRate: q.exchangeRate ? q.exchangeRate.toFixed(4) : null,
    createdAt: raw.createdAt,
    validUntil: raw.validUntil,
    deliveryTime: raw.deliveryTime ?? null,
    warrantyMonths: raw.warrantyMonths ?? null,
    notes: raw.notes ?? null,
    customer: { legalName: c.legalName, rfc: c.rfc ?? null, contactName: c.contactName ?? null },
    items: q.items.map((i) => ({
      sku: i.sku,
      description: i.description,
      details: i.details,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      discountPct: i.discountPct,
      lineTotal: i.subtotal.sub(i.discount),
      origCurrency: i.origCurrency,
      origUnitPrice: i.origUnitPrice ? i.origUnitPrice.toFixed(2) : null,
      fxRate: i.fxRate.toFixed(4),
    })),
    complements: Array.isArray(raw.complements) ? (raw.complements as QuoteComplement[]) : null,
    net: q.subtotal.sub(q.discountTotal),
    taxTotal: q.taxTotal,
    total: q.total,
    bankInfo: opts.bankInfo,
  };
}
