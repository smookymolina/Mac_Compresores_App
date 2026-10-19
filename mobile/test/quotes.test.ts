import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createApiClient, type SyncCommand } from "../src/core/api";
import { MemoryStore } from "../src/core/store";
import { SyncEngine } from "../src/core/sync";
import { CaptureBlockedError, QuoteService, type LocalQuote } from "../src/core/quotes";
import { quotePdf, type BrandAsset } from "../src/core/pdf";
import { mockFetch, uuid } from "./helpers";

const P1 = uuid(1), P2 = uuid(2), C1 = uuid(10), U1 = uuid(20), FX = uuid(30);
const NOW = Date.parse("2026-10-19T12:00:00Z");
const loadAsset = async (n: BrandAsset) => new Uint8Array(readFileSync(fileURLToPath(new URL(`../../public/brand/${n}`, import.meta.url))));

async function setup(opts: { folios?: number[]; lastSyncAt?: string } = {}) {
  const store = new MemoryStore();
  await store.init();
  await store.setMeta("user", { id: U1, name: "Juan Pérez", email: "j@x.mx", role: "VENTAS", roleName: "Ventas", permissions: [] });
  await store.setMeta("deviceId", uuid(40));
  await store.setMeta("cursor", "50");
  await store.setMeta("lastSyncAt", opts.lastSyncAt ?? "2026-10-18T12:00:00.000Z");
  await store.setMeta("folios", opts.folios ?? [1001, 1002]);
  await store.setMeta("config", { bankInfo: ["Banco X"], sellerBlockPng: null, maxDiscountPct: "0.15", canOverridePrice: false, priceGraceDays: 3, maxOfflineDays: 7 });
  await store.put("Product", [
    { id: P1, sku: "ABC-1", description: "Filtro", line: "REFACCIONES", kind: "PRODUCT", unit: "PZA", currency: "MXN", price: "1200.00", taxRate: "0.16", status: "ACTIVE" },
    { id: P2, sku: "TUB-1", description: "Tubería", line: "TUBERIA", kind: "PRODUCT", unit: "M", currency: "USD", price: "10.00", taxRate: "0.16", status: "ACTIVE" },
  ]);
  await store.put("Customer", [{ id: C1, legalName: "Cliente Demo SA", rfc: "XAXX010101000", contacts: [{ name: "Ana" }] }]);
  await store.put("ExchangeRate", [{ id: FX, rate: "18.5000", createdAt: "2026-10-18T00:00:00.000Z" }]);
  let n = 100;
  const quotes = new QuoteService({ store, now: () => NOW, uuid: () => uuid(n++) });
  return { store, quotes };
}

const input = { customerId: C1, validUntil: "2026-11-01", currency: "MXN" as const, items: [
  { productId: P1, quantity: "2", discountPct: "10" },
  { productId: P2, quantity: "3", discountPct: "0" },
] };

describe("QuoteService", () => {
  it("createQuote: fila local + quote.create con clientListPrice y descuento en %", async () => {
    const { store, quotes } = await setup();
    const q = await quotes.createQuote(input);
    expect(q).toMatchObject({ folio: 1001, status: "DRAFT", origin: "MOBILE", sellerId: U1, customerName: "Cliente Demo SA", exchangeRate: "18.5000" });
    expect(q._sync).toMatchObject({ state: "pending", commandType: "quote.create", onServer: false });
    // 2×1200 −10 % = 2160; 3×(10×18.5)=555 → neto 2715, IVA 434.40
    expect(q.total).toBe("3149.4");
    const [e] = await store.outbox();
    const cmd = e!.cmd as SyncCommand<Record<string, unknown>>;
    expect(cmd.id).toBe(q._sync!.commandId);
    expect(cmd.type).toBe("quote.create");
    expect(cmd.payload).toMatchObject({
      id: q.id, folio: 1001, catalogSeq: "50", customerId: C1, currency: "MXN", complements: [], clientExchangeRate: "18.5000",
      validUntil: "2026-11-01T12:00:00.000Z",
      items: [
        { productId: P1, quantity: "2", discountPct: "10", clientListPrice: "1200.00" },
        { productId: P2, quantity: "3", discountPct: "0", clientListPrice: "185.00" },
      ],
    });
    expect((cmd.payload.items as object[])[0]).not.toHaveProperty("unitPrice");
    expect(await store.getMeta("folios")).toEqual([1002]);
  });

  it("sin folios → provisional P-<iniciales>-n y sin folio en el comando; edición reescribe el comando pendiente", async () => {
    const { store, quotes } = await setup({ folios: [] });
    const q = await quotes.createQuote(input);
    expect(q.folio).toBeNull();
    expect(q.provisionalFolio).toBe("P-JP-1");
    const u = await quotes.updateQuote(q.id, { ...input, items: [{ productId: P1, quantity: "1", discountPct: "15" }] });
    const box = await store.outbox();
    expect(box).toHaveLength(1);
    expect(box[0]!.cmd.payload).not.toHaveProperty("folio");
    expect(box[0]!.cmd.payload).toMatchObject({ id: q.id, items: [{ quantity: "1", discountPct: "15" }] });
    expect(u._sync!.commandId).toBe(q._sync!.commandId);
    await expect(quotes.updateQuote(q.id, { ...input, items: [{ productId: P1, quantity: "1", discountPct: "20" }] })).rejects.toThrow(/descuento máximo/);
  });

  it("canCapture: >7 días sin sincronizar bloquea con CaptureBlockedError", async () => {
    const { store, quotes } = await setup({ lastSyncAt: "2026-10-01T00:00:00.000Z" });
    await expect(quotes.createQuote(input)).rejects.toBeInstanceOf(CaptureBlockedError);
    expect(await store.pendingCount()).toBe(0);
  });

  it("changeStatus valida transiciones; emailQuote encola quote.email", async () => {
    const { store, quotes } = await setup();
    const q = await quotes.createQuote(input);
    await expect(quotes.changeStatus(q.id, "ACCEPTED")).rejects.toThrow(/No se puede/);
    await quotes.changeStatus(q.id, "SENT");
    await quotes.emailQuote(q.id, { to: ["a@b.mx"], cc: [], message: "Hola" });
    expect((await store.outbox()).map((e) => e.cmd.type)).toEqual(["quote.create", "quote.status", "quote.email"]);
    await expect(quotes.emailQuote(q.id, { to: ["malo"] })).rejects.toThrow(/inválido/);
  });

  it("PDF de cotización local empieza con %PDF (también con folio provisional)", async () => {
    const { store, quotes } = await setup({ folios: [] });
    const q = await quotes.createQuote(input);
    const bytes = await quotePdf(store, q.id, { loadAsset });
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("%PDF");
  });
});

describe("SyncEngine push/conflictos/folios", () => {
  it("push antes del pull, mapea APPLIED/REJECTED/CONFLICT, se detiene en retry, consulta conflictos y repone folios", async () => {
    const { store, quotes } = await setup({ folios: [1001, 1002, 1003] });
    const a = await quotes.createQuote(input);
    const b = await quotes.createQuote(input);
    const c = await quotes.createQuote(input);
    const box = (await store.outbox()).map((e) => e.cmd.id);
    const order: string[] = [];
    let commandsCalls = 0;
    const f = mockFetch({
      "/api/sync/push": (_u, init) => {
        order.push("push");
        const ids = (JSON.parse(String(init.body)) as { commands: SyncCommand[] }).commands.map((x) => x.id);
        expect(ids).toEqual(box);
        return { body: { results: [
          { id: box[0], status: "APPLIED", result: { folio: 1001 } },
          { id: box[1], status: "CONFLICT", result: { kind: "price", items: [{ productId: P1, sku: "ABC-1", clientPrice: "1200.00", serverPrice: "1300.00" }] } },
          { id: box[2], status: "retry", error: "ocupado" },
        ] } };
      },
      "/api/sync/pull": (u) => {
        order.push("pull");
        return { body: { changes: [{ entity: "Quote", id: a.id, deleted: false, data: { ...a, _sync: undefined, _input: undefined, updatedAt: "2026-10-19T12:05:00.000Z" } }], cursor: u.searchParams.get("cursor"), hasMore: false } };
      },
      "/api/sync/commands": (u) => {
        commandsCalls++;
        expect(u.searchParams.get("ids")).toBe(box[1]);
        return { body: [{ id: box[1], status: "CONFLICT", result: { kind: "price", items: [] }, error: null, resolvedAt: null }] };
      },
      "/api/sync/config": () => ({ body: { bankInfo: ["Banco Y"], sellerBlockPng: null, maxDiscountPct: "0.15", canOverridePrice: true, priceGraceDays: 3, maxOfflineDays: 7 } }),
      "/api/sync/folios": (_u, init) => {
        expect(JSON.parse(String(init.body))).toEqual({ count: 25 });
        return { body: { folios: [1003, 1004, 1005, 1006, 1007, 1008] } };
      },
    });
    const api = createApiClient({ baseUrl: "https://erp.test", getToken: () => "tok", fetch: f.fetch });
    const engine = new SyncEngine({ api, store });
    const r = await engine.sync();
    expect(order).toEqual(["push", "pull"]);
    expect(r.push).toMatchObject({ sent: 3, applied: 1, conflicts: 1, stopped: true });
    const qa = (await store.get<LocalQuote>("Quote", a.id))!;
    expect(qa._sync).toMatchObject({ state: "applied", onServer: true, baseUpdatedAt: "2026-10-19T12:05:00.000Z" });
    expect((await store.get<LocalQuote>("Quote", b.id))!._sync).toMatchObject({ state: "conflict", conflict: { kind: "price" } });
    expect((await store.get<LocalQuote>("Quote", c.id))!._sync!.state).toBe("pending");
    expect((await store.outbox()).map((e) => e.cmd.id)).toEqual([box[2]]);
    expect((await store.outbox())[0]).toMatchObject({ attempts: 1, lastError: "ocupado" });
    expect(commandsCalls).toBe(1);
    expect((await store.getMeta("config"))!.bankInfo).toEqual(["Banco Y"]);
    // 1001–1003 ya usadas por cotizaciones locales.
    expect(await store.getMeta("folios")).toEqual([1004, 1005, 1006, 1007, 1008]);
    expect((await quotes.listIssues()).map((q) => q.id)).toEqual([b.id]);
  });

  it("conflicto resuelto por gerencia (APPLIED/REJECTED en /commands) actualiza el estado", async () => {
    const { store, quotes } = await setup();
    const a = await quotes.createQuote(input);
    const b = await quotes.createQuote(input);
    await store.put("Quote", [{ ...a, _sync: { ...a._sync!, state: "conflict" } }, { ...b, _sync: { ...b._sync!, state: "conflict" } }]);
    await store.removeOutbox([a._sync!.commandId!, b._sync!.commandId!]);
    const f = mockFetch({
      "/api/sync/pull": (u) => ({ body: { changes: [], cursor: u.searchParams.get("cursor"), hasMore: false } }),
      "/api/sync/commands": () => ({ body: [
        { id: a._sync!.commandId, status: "APPLIED", result: null, error: null, resolvedAt: "2026-10-19T13:00:00Z" },
        { id: b._sync!.commandId, status: "REJECTED", result: null, error: "Precio no autorizado", resolvedAt: "2026-10-19T13:00:00Z" },
      ] }),
    });
    const engine = new SyncEngine({ api: createApiClient({ baseUrl: "https://erp.test", getToken: () => "tok", fetch: f.fetch }), store });
    await engine.sync();
    expect((await store.get<LocalQuote>("Quote", a.id))!._sync).toMatchObject({ state: "applied", onServer: true });
    expect((await store.get<LocalQuote>("Quote", b.id))!._sync).toMatchObject({ state: "rejected", error: "Precio no autorizado" });
    expect(f.calls.some((c) => c.url.pathname === "/api/sync/push")).toBe(false);
  });
});
