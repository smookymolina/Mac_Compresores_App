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

/** Comandos de campo (clientes, ventas, cobranza, inventario) de `mobile/test/contract.test.ts`. */
const fieldRaw = JSON.parse(readFileSync(path.resolve(__dirname, "../fixtures/mobile-commands-field.json"), "utf8")) as unknown[];
const field = fieldRaw.map((c) => syncCommandSchema.parse(c));
type Cmd = (typeof field)[number];
const fieldOf = <T extends Cmd["type"]>(t: T) => field.filter((c) => c.type === t) as Extract<Cmd, { type: T }>[];

describe("contrato móvil (campo) → syncCommandSchema", () => {
  it("todos los comandos de campo son válidos", () => {
    expect(field.map((c) => c.type)).toEqual([
      "customer.save", "customer.save", "customer.contact.add", "customer.contact.remove",
      "customer.address.add", "customer.address.remove", "sale.convert", "payment.register", "inventory.movement",
    ]);
  });

  it("customer.save: alta con contacto/dirección; edición con changedFields + baseUpdatedAt", () => {
    const [create, edit] = fieldOf("customer.save").map((c) => c.payload);
    expect(create!.changedFields).toBeUndefined();
    expect(create!.creditLimit).toBe("1000.00");
    expect(create!.contact).toMatchObject({ name: "Ana" });
    expect(create!.address).toMatchObject({ street: "Av. Uno 123" });
    expect(edit!.changedFields).toEqual(["phone", "notes"]);
    expect(edit!.baseUpdatedAt).toEqual(new Date("2026-10-01T00:00:00.000Z"));
  });

  it("changedFields fuera de la lista blanca (p. ej. active) se rechaza", () => {
    const edit = fieldRaw[1] as { payload: Record<string, unknown> };
    expect(syncCommandSchema.safeParse({ ...edit, payload: { ...edit.payload, changedFields: ["active"] } }).success).toBe(false);
  });

  it("contactos y direcciones", () => {
    expect(fieldOf("customer.contact.add")[0]!.payload).toMatchObject({ name: "Luis", position: "Compras" });
    expect(fieldOf("customer.contact.remove")[0]!.payload.contactId).toBe(fieldOf("customer.contact.add")[0]!.payload.id);
    expect(fieldOf("customer.address.add")[0]!.payload).toMatchObject({ label: "Planta", zip: "66600" });
    expect(fieldOf("customer.address.remove")[0]!.payload.addressId).toBe(fieldOf("customer.address.add")[0]!.payload.id);
  });

  it("sale.convert / payment.register (decimales string) / inventory.movement", () => {
    expect(Object.keys(fieldOf("sale.convert")[0]!.payload).sort()).toEqual(["quoteId", "warehouseId"]);
    const p = fieldOf("payment.register")[0]!.payload;
    expect(p.amount).toBe("100.50");
    expect(p.paidAt).toEqual(new Date("2026-10-19"));
    const m = fieldOf("inventory.movement")[0]!.payload;
    expect(m).toMatchObject({ type: "OUT", quantity: "2" });
    const pay = fieldRaw[7] as { payload: Record<string, unknown> };
    expect(syncCommandSchema.safeParse({ ...pay, payload: { ...pay.payload, amount: "1.005" } }).success).toBe(false);
    expect(syncCommandSchema.safeParse({ ...pay, payload: { ...pay.payload, amount: "0" } }).success).toBe(false);
  });
});
