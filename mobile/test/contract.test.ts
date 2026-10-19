import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/core/store";
import { QuoteService, type LocalQuote } from "../src/core/quotes";
import { uuid } from "./helpers";

/**
 * Contrato teléfono → servidor: genera los comandos tal como los arma `QuoteService` y los compara con
 * `tests/fixtures/mobile-commands.json`, que la suite raíz valida con `syncCommandSchema`
 * (tests/unit/mobile-contract.test.ts). Si cambia el formato, regenera con `vitest -u` y corre ambas suites.
 */
const P1 = uuid(1), P2 = uuid(2), C1 = uuid(10), U1 = uuid(20);
const NOW = Date.parse("2026-10-19T12:00:00Z");

describe("contrato de comandos móviles", () => {
  it("quote.create / quote.update / quote.status / quote.email", async () => {
    const store = new MemoryStore();
    await store.init();
    await store.setMeta("user", { id: U1, name: "Juan Pérez", email: "j@x.mx", role: "VENTAS", roleName: "Ventas", permissions: [] });
    await store.setMeta("deviceId", uuid(40));
    await store.setMeta("cursor", "50");
    await store.setMeta("lastSyncAt", "2026-10-18T12:00:00.000Z");
    await store.setMeta("folios", [1001]);
    await store.setMeta("config", { bankInfo: [], sellerBlockPng: null, maxDiscountPct: "0.15", canOverridePrice: true, priceGraceDays: 3, maxOfflineDays: 7 });
    await store.put("Product", [
      { id: P1, sku: "ABC-1", description: "Filtro", line: "REFACCIONES", kind: "PRODUCT", unit: "PZA", currency: "MXN", price: "1200.00", taxRate: "0.16", status: "ACTIVE" },
      { id: P2, sku: "TUB-1", description: "Tubería", line: "TUBERIA", kind: "PRODUCT", unit: "M", currency: "USD", price: "10.00", taxRate: "0.16", status: "ACTIVE" },
    ]);
    await store.put("Customer", [{ id: C1, legalName: "Cliente Demo SA" }]);
    await store.put("ExchangeRate", [{ id: uuid(30), rate: "18.5000", createdAt: "2026-10-18T00:00:00.000Z" }]);
    let n = 100;
    const quotes = new QuoteService({ store, now: () => NOW, uuid: () => uuid(n++) });

    const q = await quotes.createQuote({
      customerId: C1, validUntil: "2026-11-01", currency: "MXN", notes: " Nota ", warrantyMonths: 6,
      complements: [{ code: "INST", name: "Instalación", activities: ["Montaje"] }],
      items: [{ productId: P1, quantity: "2", discountPct: "10" }, { productId: P2, quantity: "1.5", discountPct: "12.5", details: "x" }],
    });
    // Simula que el create se aplicó en el servidor para que la edición genere quote.update.
    const applied: LocalQuote = { ...q, updatedAt: "2026-10-19T12:00:01.000Z", _sync: { state: "applied", commandId: null, onServer: true, baseUpdatedAt: "2026-10-19T12:00:01.000Z" } };
    await store.put("Quote", [applied]);
    await quotes.updateQuote(q.id, { customerId: C1, validUntil: "2026-11-02", items: [{ productId: P1, quantity: "1", discountPct: "15", unitPrice: "999.5" }] });
    await quotes.changeStatus(q.id, "SENT");
    await quotes.emailQuote(q.id, { to: [" a@b.mx "], cc: ["c@d.mx"], message: "Hola" });

    const cmds = (await store.outbox()).map((e) => e.cmd);
    expect(cmds.map((c) => c.type)).toEqual(["quote.create", "quote.update", "quote.status", "quote.email"]);
    await expect(JSON.stringify(cmds, null, 2) + "\n").toMatchFileSnapshot("../../tests/fixtures/mobile-commands.json");
  });
});
