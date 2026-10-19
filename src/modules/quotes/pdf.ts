import { readFile } from "node:fs/promises";
import path from "node:path";
import type { getQuote } from "./service";
import { db } from "@/lib/db";
import { presentQuote } from "./currency";
import type { QuoteComplement } from "@/modules/complements/match";
import { renderQuotePdf as drawQuotePdf, type QuotePdfAssets, type QuotePdfData } from "@/domain/quote-pdf";

type QuoteFull = Awaited<ReturnType<typeof getQuote>>;

// Cargador de servidor: lee imágenes de marca (fs), el bloque del asesor (BD) y BANK_INFO (env),
// arma los datos planos y delega el dibujo al renderizador puro `@/domain/quote-pdf`.

export const bankInfo = () => (process.env.BANK_INFO ?? "").split("|").map((l) => l.trim()).filter(Boolean).slice(0, 8);

/** Datos planos para el renderizador (montos ya presentados en la moneda de la cotización). */
export function toQuotePdfData(raw: QuoteFull, bank: string[] = bankInfo()): QuotePdfData {
  const q = presentQuote(raw);
  return {
    folio: q.folio,
    currency: q.currency,
    exchangeRate: q.exchangeRate ? q.exchangeRate.toFixed(4) : null,
    createdAt: q.createdAt,
    validUntil: q.validUntil,
    deliveryTime: q.deliveryTime,
    warrantyMonths: q.warrantyMonths,
    notes: q.notes,
    customer: { legalName: q.customer.legalName, rfc: q.customer.rfc, contactName: q.customer.contacts[0]?.name ?? null },
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
    complements: Array.isArray(q.complements) ? (q.complements as unknown as QuoteComplement[]) : null,
    net: q.subtotal.sub(q.discountTotal),
    taxTotal: q.taxTotal,
    total: q.total,
    bankInfo: bank,
  };
}

export async function loadQuotePdfAssets(sellerId: string): Promise<QuotePdfAssets> {
  const brandDir = path.join(process.cwd(), "public/brand");
  const [headerPng, footerPng, milwaukeeJpg, seller] = await Promise.all([
    readFile(path.join(brandDir, "quote-header.png")),
    readFile(path.join(brandDir, "quote-footer.png")),
    readFile(path.join(brandDir, "milwaukee.jpg")),
    db.user.findUnique({ where: { id: sellerId }, select: { quoteBlock: true } }),
  ]);
  return { headerPng, footerPng, milwaukeeJpg, sellerBlockPng: seller?.quoteBlock ?? null };
}

export async function renderQuotePdf(raw: QuoteFull): Promise<Uint8Array> {
  return drawQuotePdf(toQuotePdfData(raw), await loadQuotePdfAssets(raw.seller.id));
}
