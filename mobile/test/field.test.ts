import { describe, expect, it } from "vitest";
import { createApiClient, type SyncCommand } from "../src/core/api";
import { SyncEngine, listSyncIssues } from "../src/core/sync";
import type { LocalCustomer } from "../src/core/customers";
import type { LocalStockBalance } from "../src/core/inventory";
import { PermissionError } from "../src/core/local";
import { pendingSaleId, saleBalance, saleFolioLabel, type LocalSale } from "../src/core/sales";
import { mockFetch, uuid } from "./helpers";

import { ALL, C1, P1, P2, Q1, S1, U1, W1, confirmedSale, fieldSetup } from "./field-setup";

/** Servidor simulado: push responde con `results(cmd)`; pull devuelve `changes` una vez. */
function server(results: (c: SyncCommand) => { status: string; result?: unknown; error?: string }, changes: unknown[] = [], commands: unknown[] = []) {
  let pulled = false;
  const pushed: SyncCommand[] = [];
  const f = mockFetch({
    "/api/sync/push": (_u, init) => {
      const cmds = (JSON.parse(String(init.body)) as { commands: SyncCommand[] }).commands;
      pushed.push(...cmds);
      return { body: { results: cmds.map((c) => ({ id: c.id, ...results(c) })) } };
    },
    "/api/sync/pull": () => {
      const body = { changes: pulled ? [] : changes, cursor: "60", hasMore: false };
      pulled = true;
      return { body };
    },
    "/api/sync/commands": () => ({ body: commands }),
  });
  return { api: createApiClient({ baseUrl: "https://erp.test", getToken: () => "t", fetch: f.fetch }), pushed };
}

describe("CustomerService", () => {
  it("alta + edición: changedFields solo con lo que cambió, decimales string, baseUpdatedAt del servidor", async () => {
    const { store, customers } = await fieldSetup();
    const c = await customers.createCustomer({ legalName: " Nuevo SA ", rfc: "aaa010101aaa", paymentTermsDays: 15, creditLimit: "1000", contact: { name: "Ana" } });
    expect(c._sync).toMatchObject({ state: "pending", onServer: false });
    // Cliente existente (del servidor): editar teléfono y crédito; razón social igual.
    await customers.updateCustomer(C1, { legalName: "Cliente Demo SA", phone: " 8112345678 ", creditLimit: "50000" });
    expect((await store.outbox()).length).toBe(2);
    const u = await customers.updateCustomer(C1, { creditLimit: "60000.5" });
    const cmds = (await store.outbox()).map((e) => e.cmd);
    expect(cmds).toHaveLength(2); // la segunda edición reescribe el comando pendiente
    expect(cmds[0]!.payload).toMatchObject({ id: c.id, legalName: "Nuevo SA", rfc: "AAA010101AAA", creditLimit: "1000.00", contact: { name: "Ana" } });
    expect(cmds[1]!.payload).toMatchObject({ id: C1, baseUpdatedAt: "2026-10-01T00:00:00.000Z", changedFields: ["phone", "creditLimit"], phone: "8112345678", creditLimit: "60000.50", notes: "" });
    expect(u).toMatchObject({ phone: "8112345678", creditLimit: "60000.50", _sync: { state: "pending" } });
    // Sin cambios → sin comando.
    await customers.updateCustomer(C1, { phone: "8112345678" });
    expect(await store.pendingCount()).toBe(2);
    await expect(customers.updateCustomer(c.id, { rfc: "XAXX010101000" })).rejects.toThrow(/ya pertenece/);
  });

  it("contactos/direcciones; conflicto duplicate_rfc y alta rechazada revierten localmente", async () => {
    const { store, customers } = await fieldSetup();
    const a = await customers.addContact(C1, { name: "Luis", email: "l@x.mx" });
    const ct = a.contacts[0]!;
    await customers.addAddress(C1, { street: "Av. Uno 123", city: "MTY" });
    await customers.updateCustomer(C1, { rfc: "BBB010101BBB" });
    const s = server((c) => c.type === "customer.save" ? { status: "CONFLICT", result: { kind: "duplicate_rfc", rfc: "BBB010101BBB" } }
      : c.type === "customer.address.add" ? { status: "REJECTED", error: "x" } : { status: "APPLIED" });
    await new SyncEngine({ api: s.api, store }).sync();
    expect(s.pushed.map((c) => c.type)).toEqual(["customer.contact.add", "customer.address.add", "customer.save"]);
    expect(s.pushed[0]!.payload).toEqual({ customerId: C1, id: ct.id, name: "Luis", email: "l@x.mx" });
    const row = (await store.get<LocalCustomer>("Customer", C1))!;
    expect(row.contacts).toEqual([{ id: ct.id, name: "Luis", position: null, email: "l@x.mx", phone: null }]);
    expect(row.addresses).toEqual([]);
    expect(row._sync).toMatchObject({ state: "conflict", conflict: { kind: "duplicate_rfc" } });
    expect((await listSyncIssues(store)).map((i) => i.entity)).toEqual(["Customer"]);
    await customers.removeContact(C1, ct.id);
    expect((await store.outbox())[0]!.cmd.payload).toEqual({ customerId: C1, contactId: ct.id });
  });
});

describe("SalesService", () => {
  it("venta pendiente: avisa existencia, APPLIED y luego la reemplaza la venta del pull", async () => {
    const { store, sales } = await fieldSetup();
    const { sale, warnings } = await sales.convertQuote(Q1, W1);
    expect(warnings).toEqual([{ productId: P1, sku: "ABC-1", requested: "5", available: "3" }]);
    expect(sale).toMatchObject({ id: pendingSaleId(Q1), status: "PENDING_SYNC", total: "5800.00", folio: null });
    expect(saleFolioLabel(sale)).toBe("Venta pendiente");
    expect(sale.items[1]).not.toHaveProperty("unitCost");
    expect((await store.outbox())[0]!.cmd.payload).toEqual({ quoteId: Q1, warehouseId: W1 });
    await expect(sales.convertQuote(Q1, W1)).rejects.toThrow(/pendiente/);
    await expect(sales.registerPayment(sale.id, { amount: "100", method: "CASH" })).rejects.toThrow(/aún no está confirmada/);

    const s = server(() => ({ status: "APPLIED", result: { saleId: S1, folio: 77 } }), [
      { entity: "Sale", id: S1, deleted: false, data: { ...confirmedSale(), quoteId: Q1 } },
    ]);
    const engine = new SyncEngine({ api: s.api, store });
    // Solo push: queda aplicada con folio real a la espera del pull.
    await engine.push();
    expect(await store.get<LocalSale>("Sale", pendingSaleId(Q1))).toMatchObject({ folio: 77, serverSaleId: S1, _sync: { state: "applied" } });
    await engine.pull();
    expect(await store.get("Sale", pendingSaleId(Q1))).toBeNull();
    expect(await sales.listSales()).toMatchObject([{ id: S1, status: "CONFIRMED" }]);
  });

  it("conflicto de existencia visible y resuelto por gerencia (polling)", async () => {
    const { store, sales } = await fieldSetup();
    await sales.convertQuote(Q1, W1);
    const conflict = { kind: "stock", warehouseId: W1, items: [{ productId: P1, sku: "ABC-1", requested: "5", available: "3" }] };
    const s = server(() => ({ status: "CONFLICT", result: conflict }), [], []);
    const engine = new SyncEngine({ api: s.api, store });
    await engine.sync();
    const pend = (await store.get<LocalSale>("Sale", pendingSaleId(Q1)))!;
    expect(pend._sync).toMatchObject({ state: "conflict", conflict });
    expect((await listSyncIssues(store))[0]).toMatchObject({ entity: "Sale", label: "Venta pendiente" });
    const s2 = server(() => ({ status: "APPLIED" }), [], [{ id: pend._sync!.commandId, status: "APPLIED", result: { saleId: S1, folio: 80 } }]);
    await new SyncEngine({ api: s2.api, store }).pollConflicts();
    expect(await store.get<LocalSale>("Sale", pendingSaleId(Q1))).toMatchObject({ folio: 80, serverSaleId: S1, _sync: { state: "applied" } });
  });

  it("pagos: saldo = total − pagos vigentes − pendientes; excedente bloqueado; rechazo libera saldo", async () => {
    const { store, sales } = await fieldSetup();
    await store.put("Sale", [confirmedSale([
      { id: uuid(80), saleId: S1, amount: "500.00", paidAt: "2026-10-02", method: "CASH", reference: null, voidedAt: null },
      { id: uuid(81), saleId: S1, amount: "300.00", paidAt: "2026-10-03", method: "CASH", reference: null, voidedAt: "2026-10-04T00:00:00.000Z" },
    ])]);
    const p = await sales.registerPayment(S1, { amount: "160.5", method: "TRANSFER", reference: " SPEI-1 " });
    expect((await store.outbox())[0]!.cmd.payload).toEqual({ id: p.id, saleId: S1, amount: "160.50", paidAt: "2026-10-19", method: "TRANSFER", reference: "SPEI-1" });
    const b = saleBalance((await sales.getSale(S1))!);
    expect([b.paid.toFixed(2), b.pendingPaid.toFixed(2), b.balance.toFixed(2)]).toEqual(["500.00", "160.50", "499.50"]);
    await expect(sales.registerPayment(S1, { amount: "499.51", method: "CASH" })).rejects.toThrow(/excede el saldo/);
    const s = server(() => ({ status: "REJECTED", error: "El pago excede el saldo." }), [
      { entity: "Sale", id: S1, deleted: false, data: confirmedSale([{ id: uuid(80), saleId: S1, amount: "500.00", paidAt: "2026-10-02", method: "CASH", reference: null, voidedAt: null }]) },
    ]);
    await new SyncEngine({ api: s.api, store }).sync();
    const after = (await sales.getSale(S1))!;
    expect(after.payments.map((x) => x._sync?.state ?? "server")).toEqual(["server", "rejected"]); // el rechazado sobrevive al pull
    expect(saleBalance(after).balance.toFixed(2)).toBe("660.00");
    await sales.dismissRejected(S1, p.id);
    expect((await sales.getSale(S1))!.payments).toHaveLength(1);
  });
});

describe("InventoryService", () => {
  it("movimiento optimista; REJECTED revierte; APPLIED + pull deja la existencia del servidor", async () => {
    const { store, inventory } = await fieldSetup();
    const { movement, balance, warning } = await inventory.registerMovement({ productId: P1, warehouseId: W1, type: "OUT", quantity: "5", reason: "Merma" });
    expect(movement.delta).toBe("-5");
    expect(balance).toMatchObject({ quantity: "-2", _serverQuantity: "3", _pending: true });
    expect(warning).toMatch(/-2/);
    expect((await store.outbox())[0]!.cmd.payload).toEqual({ id: movement.id, productId: P1, warehouseId: W1, type: "OUT", quantity: "5", reason: "Merma" });
    await inventory.registerMovement({ productId: P1, warehouseId: W1, type: "IN", quantity: "10.5", reason: "Compra" });
    expect((await inventory.listMovements({ state: "pending" })).map((m) => m.type)).toEqual(["IN", "OUT"]);

    const s = server((c) => (c.payload as { type: string }).type === "OUT" ? { status: "REJECTED", error: "Existencia insuficiente" } : { status: "APPLIED" }, [
      { entity: "StockBalance", id: `${P1}:${W1}`, deleted: false, data: { id: `${P1}:${W1}`, productId: P1, warehouseId: W1, quantity: "13.500", minStock: "0" } },
    ]);
    const engine = new SyncEngine({ api: s.api, store });
    await engine.push();
    expect((await store.get<LocalStockBalance>("StockBalance", `${P1}:${W1}`))!.quantity).toBe("13.5");
    await engine.pull();
    const [b] = await inventory.listBalances({ warehouseId: W1, q: "filtro" });
    expect(b).toMatchObject({ quantity: "13.5", sku: "ABC-1" });
    expect(b!._pending).toBeUndefined();
    expect((await listSyncIssues(store)).map((i) => i.entity)).toEqual(["InventoryMovement"]);
  });

  it("pull con movimiento aún pendiente suma el delta local", async () => {
    const { store, inventory } = await fieldSetup();
    await inventory.registerMovement({ productId: P1, warehouseId: W1, type: "ADJUST", quantity: "-1", reason: "Conteo" });
    const s = server(() => ({ status: "retry" }), [
      { entity: "StockBalance", id: `${P1}:${W1}`, deleted: false, data: { id: `${P1}:${W1}`, productId: P1, warehouseId: W1, quantity: "4.000" } },
    ]);
    await new SyncEngine({ api: s.api, store }).sync();
    expect(await store.get("StockBalance", `${P1}:${W1}`)).toMatchObject({ quantity: "3", _serverQuantity: "4", _pending: true });
  });
});

describe("permisos", () => {
  it("sin permisos: cada captura lanza PermissionError y no encola nada", async () => {
    const { store, customers, sales, inventory } = await fieldSetup([]);
    await store.put("Sale", [confirmedSale()]);
    await expect(customers.createCustomer({ legalName: "X SA" })).rejects.toBeInstanceOf(PermissionError);
    await expect(customers.addContact(C1, { name: "Ana" })).rejects.toBeInstanceOf(PermissionError);
    await expect(sales.convertQuote(Q1, W1)).rejects.toBeInstanceOf(PermissionError);
    await expect(sales.registerPayment(S1, { amount: "1", method: "CASH" })).rejects.toBeInstanceOf(PermissionError);
    await expect(inventory.registerMovement({ productId: P1, warehouseId: W1, type: "IN", quantity: "1", reason: "abc" })).rejects.toBeInstanceOf(PermissionError);
    expect(await store.pendingCount()).toBe(0);
    expect(await sales.can("sales.create")).toBe(false);
  });

  it("más de 7 días sin sincronizar bloquea la captura", async () => {
    const { store, customers } = await fieldSetup();
    await store.setMeta("lastSyncAt", "2026-10-01T00:00:00.000Z");
    await expect(customers.createCustomer({ legalName: "X SA" })).rejects.toThrow(/sin sincronizar/);
  });
});
