import { describe, expect, it } from "vitest";
import { ResyncError, UnauthorizedError, createApiClient, type SyncEntity } from "../src/core/api";
import { MemoryStore } from "../src/core/store";
import { SyncEngine } from "../src/core/sync";
import { Session, memoryKV } from "../src/core/session";
import { dec, round2 } from "@domain/money";
import { mockFetch, uuid } from "./helpers";

const P1 = uuid(1), P2 = uuid(2), P3 = uuid(3), C1 = uuid(10);

function server(opts: { pull?: (cursor: string, n: number) => { status?: number; body: unknown } } = {}) {
  let pulls = 0;
  const bootstraps: string[] = [];
  const data: Partial<Record<SyncEntity, Record<string, unknown>[]>> = {
    Product: [
      { id: P1, sku: "ABC-123", oemPartNumber: "1622-0001", description: "Filtro de aire", searchText: "filtro aire compresor", price: "1200.00", status: "ACTIVE" },
      { id: P2, sku: "XYZ-9", oemPartNumber: null, description: "Válvula de admisión", searchText: "valvula", price: "500.00", status: "ACTIVE" },
    ],
    Customer: [{ id: C1, legalName: "Cliente Demo", rfc: "XAXX010101000", ownerId: null, active: true }],
  };
  const f = mockFetch({
    "/api/sync/bootstrap": (url) => {
      const entity = url.searchParams.get("entity") as SyncEntity;
      const after = url.searchParams.get("after");
      const limit = Number(url.searchParams.get("limit"));
      bootstraps.push(entity);
      const rows = (data[entity] ?? []).filter((r) => !after || String(r.id) > after).slice(0, limit);
      const next = rows.length === limit ? String(rows[rows.length - 1]!.id) : null;
      return { body: { entity, items: rows, next, ...(!after && { serverSeq: entity === "Product" ? "100" : "105" }) } };
    },
    "/api/sync/pull": (url) => {
      const cursor = url.searchParams.get("cursor")!;
      pulls++;
      if (opts.pull) return opts.pull(cursor, pulls);
      if (cursor === "100") return { body: { changes: [
        { entity: "Product", id: P1, deleted: false, data: { id: P1, sku: "ABC-123", description: "Filtro de aire v2", searchText: "", price: "1350.00", status: "ACTIVE" } },
      ], cursor: "101", hasMore: true } };
      if (cursor === "101") return { body: { changes: [
        { entity: "Product", id: P2, deleted: true, data: null },
        { entity: "Product", id: P3, deleted: false, data: { id: P3, sku: "NEW-1", description: "Nuevo", price: "10.00" } },
      ], cursor: "102", hasMore: false } };
      return { body: { changes: [], cursor, hasMore: false } };
    },
  });
  const api = createApiClient({ baseUrl: "https://erp.test/", getToken: () => "tok", fetch: f.fetch });
  return { api, calls: f.calls, bootstraps, data, pulls: () => pulls };
}

describe("SyncEngine", () => {
  it("bootstrap y luego pull aplica cambios y bajas; cursor desde el primer serverSeq", async () => {
    const s = server();
    const store = new MemoryStore();
    await store.init();
    const engine = new SyncEngine({ api: s.api, store, bootstrapPageSize: 1, now: () => new Date("2026-10-19T12:00:00Z") });
    const r = await engine.sync();
    expect(r).toMatchObject({ bootstrapped: true, changes: 3, cursor: "102" });
    expect(s.calls[0]!.url.pathname).toBe("/api/sync/bootstrap");
    expect(new Headers(s.calls[0]!.init.headers).get("authorization")).toBe("Bearer tok");
    expect(new Headers(s.calls[0]!.init.headers).get("x-sync-protocol")).toBe("1");
    expect(s.calls.find((c) => c.url.pathname === "/api/sync/pull")!.url.searchParams.get("cursor")).toBe("100");
    expect((await store.get("Product", P1))!.description).toBe("Filtro de aire v2");
    expect(await store.get("Product", P2)).toBeNull();
    expect(await store.get("Product", P3)).not.toBeNull();
    expect(await store.get("Customer", C1)).toMatchObject({ legalName: "Cliente Demo" });
    expect(await store.getMeta("serverSeq")).toBe("100");
    expect(await store.getMeta("cursor")).toBe("102");
    expect(await store.getMeta("lastSyncAt")).toBe("2026-10-19T12:00:00.000Z");
    // búsqueda por prefijo sin acentos
    expect((await store.search("Product", "filt aire")).map((p) => p.id)).toEqual([P1]);
    expect((await store.search("Customer", "client")).map((p) => p.id)).toEqual([C1]);

    // Segunda sincronización: solo pull incremental.
    const r2 = await engine.sync();
    expect(r2).toMatchObject({ bootstrapped: false, changes: 0, cursor: "102" });
  });

  it("410 RESYNC borra entidades y vuelve a hacer bootstrap (outbox intacto)", async () => {
    let first = true;
    const s = server({ pull: (cursor) => {
      if (cursor === "500" && first) { first = false; return { status: 410, body: { error: "Vuelve a descargar", code: "RESYNC" } }; }
      return { body: { changes: [], cursor: cursor === "500" ? "500" : "100", hasMore: false } };
    } });
    const store = new MemoryStore();
    await store.init();
    await store.setMeta("cursor", "500");
    await store.put("Product", [{ id: uuid(99), sku: "VIEJO" }]);
    await store.enqueue({ id: uuid(77), type: "quote.status", capturedAt: "2026-10-19T00:00:00Z", payload: {} });
    const r = await new SyncEngine({ api: s.api, store }).sync();
    expect(r.bootstrapped).toBe(true);
    expect(await store.get("Product", uuid(99))).toBeNull();
    expect(await store.count("Product")).toBe(2);
    expect(await store.getMeta("cursor")).toBe("100");
    expect(await store.pendingCount()).toBe(1);
  });

  it("410 repetido durante el re-bootstrap se propaga (sin bucle)", async () => {
    const s = server({ pull: () => ({ status: 410, body: { code: "RESYNC" } }) });
    const store = new MemoryStore();
    await store.init();
    await store.setMeta("cursor", "5");
    await expect(new SyncEngine({ api: s.api, store }).sync()).rejects.toBeInstanceOf(ResyncError);
  });

  it("401 borra datos locales y la sesión", async () => {
    const s = server({ pull: () => ({ status: 401, body: { error: "Dispositivo revocado o desconocido.", code: "UNAUTHENTICATED" } }) });
    const store = new MemoryStore();
    await store.init();
    const secure = memoryKV({ "device.token": "tok" });
    const prefs = memoryKV();
    const session = new Session({ api: s.api, store, secure, prefs, platform: "ANDROID", appVersion: "1.4.0", iterations: 1000 });
    await session.setPin("1234");
    await store.setMeta("cursor", "100");
    await store.put("Customer", [{ id: C1, legalName: "X" }]);
    await store.enqueue({ id: uuid(77), type: "quote.status", capturedAt: "2026-10-19T00:00:00Z", payload: {} });
    const engine = new SyncEngine({ api: s.api, store, onUnauthorized: () => session.wipe() });
    await expect(engine.sync()).rejects.toBeInstanceOf(UnauthorizedError);
    expect(await store.count("Customer")).toBe(0);
    expect(await store.getMeta("cursor")).toBeNull();
    expect(await store.pendingCount()).toBe(0);
    expect(await session.isRegistered()).toBe(false);
    expect(secure.dump()).toEqual({});
    expect(prefs.dump()).toEqual({});
  });

  it("errores tipados: offline, upgrade, servidor", async () => {
    const { createApiClient: mk, OfflineError, UpgradeError, ServerError } = await import("../src/core/api");
    const off = mk({ baseUrl: "https://x", getToken: () => "t", fetch: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch });
    await expect(off.pull("0")).rejects.toBeInstanceOf(OfflineError);
    const up = mockFetch({ "/api/sync/pull": () => ({ status: 409, body: { error: "Actualiza", code: "CONFLICT", upgrade: true } }) });
    await expect(mk({ baseUrl: "https://x", getToken: () => "t", fetch: up.fetch }).pull("0")).rejects.toBeInstanceOf(UpgradeError);
    const se = mockFetch({ "/api/sync/pull": () => ({ status: 500, body: { error: "x", code: "INTERNAL" } }) });
    await expect(mk({ baseUrl: "https://x", getToken: () => "t", fetch: se.fetch }).pull("0")).rejects.toBeInstanceOf(ServerError);
  });

  it("@domain se resuelve (decimal.js, half-up)", () => {
    expect(round2(dec("1.005")).toFixed(2)).toBe("1.01");
  });
});
