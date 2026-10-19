import { readFileSync } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { renderQuotePdf, type QuotePdfData } from "@/domain/quote-pdf";

const brand = (f: string) => new Uint8Array(readFileSync(path.join(process.cwd(), "public/brand", f)));

const data: QuotePdfData = {
  folio: 123,
  currency: "MXN",
  exchangeRate: null,
  createdAt: "2026-01-15T12:00:00Z",
  validUntil: "2026-01-30T12:00:00Z",
  deliveryTime: "3 días hábiles",
  warrantyMonths: 6,
  notes: "Nota de prueba\nSegunda línea",
  customer: { legalName: "Cliente Prueba SA de CV", rfc: "XAXX010101000", contactName: "Juan Pérez" },
  items: [
    { sku: "SVC-8000", description: "Servicio 8000 h", details: "Cambio de filtros", quantity: "1", unitPrice: "1000.00",
      discountPct: "0", lineTotal: "1000.00", origCurrency: "MXN", origUnitPrice: null, fxRate: "1.0000" },
    { sku: "REF-1", description: "Refacción importada", quantity: "2", unitPrice: "180.00",
      discountPct: "0.1", lineTotal: "324.00", origCurrency: "USD", origUnitPrice: "10.00", fxRate: "18.0000" },
  ],
  complements: null,
  net: "1324.00",
  taxTotal: "211.84",
  total: "1535.84",
  bankInfo: ["Banco: X", "CLABE: 000"],
};

describe("renderQuotePdf (puro)", () => {
  it("genera un PDF válido con bytes en memoria", async () => {
    const bytes = await renderQuotePdf(data, {
      headerPng: brand("quote-header.png"), footerPng: brand("quote-footer.png"), milwaukeeJpg: brand("milwaukee.jpg"),
    });
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
