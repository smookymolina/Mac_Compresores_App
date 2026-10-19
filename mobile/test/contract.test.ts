import { describe, expect, it } from "vitest";
import { MemoryStore } from "../src/core/store";
import { QuoteService, type LocalQuote } from "../src/core/quotes";
import { uuid } from "./helpers";
import { C1 as FC1, P1 as FP1, Q1, S1, W1, confirmedSale, fieldSetup } from "./field-setup";

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

  it("customer.* / sale.convert / payment.register / inventory.movement (fixture mobile-commands-field.json)", async () => {
    const { store, customers, sales, inventory } = await fieldSetup();
    await store.put("Sale", [confirmedSale()]);
    const c = await customers.createCustomer({ legalName: "Nuevo SA", rfc: "AAA010101AAA", email: "n@x.mx", paymentTermsDays: 15, creditLimit: "1000", contact: { name: "Ana", phone: "811" }, address: { street: "Av. Uno 123", city: "MTY" } });
    await customers.updateCustomer(FC1, { phone: "8112345678", notes: "VIP" });
    const withC = await customers.addContact(FC1, { name: "Luis", position: "Compras", email: "l@x.mx" });
    await customers.removeContact(FC1, withC.contacts[0]!.id);
    const withA = await customers.addAddress(FC1, { label: "Planta", street: "Calle 2 #45", city: "Apodaca", state: "NL", zip: "66600" });
    await customers.removeAddress(FC1, withA.addresses[0]!.id);
    await sales.convertQuote(Q1, W1);
    await sales.registerPayment(S1, { amount: "100.5", method: "TRANSFER", paidAt: "2026-10-19", reference: "SPEI-1" });
    await inventory.registerMovement({ productId: FP1, warehouseId: W1, type: "OUT", quantity: "2", reason: "Merma" });
    const cmds = (await store.outbox()).map((e) => e.cmd);
    expect(c.id).toBe(cmds[0]!.payload.id);
    expect(cmds.map((x) => x.type)).toEqual([
      "customer.save", "customer.save", "customer.contact.add", "customer.contact.remove", "customer.address.add", "customer.address.remove",
      "sale.convert", "payment.register", "inventory.movement",
    ]);
    await expect(JSON.stringify(cmds, null, 2) + "\n").toMatchFileSnapshot("../../tests/fixtures/mobile-commands-field.json");
  });
});
