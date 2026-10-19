import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncCommandSchema } from "@/modules/sync/protocol";

/** Comandos generados por `mobile/src/core/quotes.ts` (ver mobile/test/contract.test.ts, que mantiene este fixture). */
const raw = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/mobile-commands.json"), "utf8")) as unknown[];
const parsed = raw.map((c) => syncCommandSchema.parse(c));
const byType = <T extends (typeof parsed)[number]["type"]>(t: T) => parsed.find((c) => c.type === t) as Extract<(typeof parsed)[number], { type: T }>;

describe("contrato móvil → syncCommandSchema", () => {
  it("todos los comandos del teléfono son válidos", () => {
    expect(parsed.map((c) => c.type)).toEqual(["quote.create", "quote.update", "quote.status", "quote.email"]);
    for (const c of parsed) expect(c.capturedAt).toEqual(new Date("2026-10-19T12:00:00.000Z"));
  });

  it("quote.create: porcentajes → fracción, decimales, catalogSeq bigint", () => {
    const c = byType("quote.create").payload;
    expect(c.folio).toBe(1001);
    expect(c.catalogSeq).toBe(BigInt(50));
    expect(c.currency).toBe("MXN");
    expect(c.validUntil).toEqual(new Date("2026-11-01T12:00:00.000Z"));
    expect(c.warrantyMonths).toBe(6);
    expect(c.clientExchangeRate).toBe("18.5000");
    expect(c.complements).toEqual([{ code: "INST", name: "Instalación", activities: ["Montaje"] }]);
    expect(c.items.map((i) => [String(i.discountPct), i.clientListPrice, i.unitPrice])).toEqual([
      ["0.1000", "1200.00", undefined],
      ["0.1250", "185.00", undefined],
    ]);
    expect(c.items[1]!.quantity).toBe("1.5");
  });

  it("quote.update: precio manual + baseUpdatedAt", () => {
    const u = byType("quote.update").payload;
    expect(u.baseUpdatedAt).toEqual(new Date("2026-10-19T12:00:01.000Z"));
    expect(u.items[0]).toMatchObject({ unitPrice: "999.50", quantity: "1" });
    expect(String(u.items[0]!.discountPct)).toBe("0.1500");
    expect(u.items[0]!.clientListPrice).toBeUndefined();
  });

  it("quote.status / quote.email", () => {
    expect(byType("quote.status").payload.to).toBe("SENT");
    expect(byType("quote.email").payload).toEqual({ quoteId: "00000000-0000-4000-8000-000000000100", to: ["a@b.mx"], cc: ["c@d.mx"], message: "Hola" });
  });
});
