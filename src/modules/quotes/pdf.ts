import { readFile } from "node:fs/promises";
import path from "node:path";
import type { getQuote } from "./service";
import { db } from "@/lib/db";
import { toQuotePdfData as toPlainPdfData } from "@/domain/quote-pdf-data";
import { renderQuotePdf as drawQuotePdf, type QuotePdfAssets, type QuotePdfData } from "@/domain/quote-pdf";

type QuoteFull = Awaited<ReturnType<typeof getQuote>>;

// Cargador de servidor: lee imágenes de marca (fs), el bloque del asesor (BD) y BANK_INFO (env),
// arma los datos planos y delega el dibujo al renderizador puro `@/domain/quote-pdf`.

export const bankInfo = () => (process.env.BANK_INFO ?? "").split("|").map((l) => l.trim()).filter(Boolean).slice(0, 8);

/** Datos planos para el renderizador (mapeo compartido con la app móvil: `@/domain/quote-pdf-data`). */
export function toQuotePdfData(raw: QuoteFull, bank: string[] = bankInfo()): QuotePdfData {
  return toPlainPdfData(raw, {
    bankInfo: bank,
    customer: { legalName: raw.customer.legalName, rfc: raw.customer.rfc, contactName: raw.customer.contacts[0]?.name ?? null },
  });
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
