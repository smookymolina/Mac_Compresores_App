import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/core/api";
import { AppController, type NetworkAdapter } from "../src/core/app";
import { MemoryStore } from "../src/core/store";
import { Session, memoryKV } from "../src/core/session";
import { mockFetch } from "./helpers";

describe("AppController", () => {
  it("sin red: offline; al recuperar red sincroniza; >7 días → canCapture=false", async () => {
    const f = mockFetch({
      "/api/sync/pull": (u) => ({ body: { changes: [], cursor: u.searchParams.get("cursor"), hasMore: false } }),
    });
    let session: Session;
    const api = createApiClient({ baseUrl: "https://erp.test", getToken: () => session.getToken(), fetch: f.fetch });
    const store = new MemoryStore();
    await store.init();
    await store.setMeta("cursor", "10");
    await store.setMeta("lastSyncAt", "2026-10-01T00:00:00.000Z");
    session = new Session({ api, store, secure: memoryKV({ "device.token": "t" }), prefs: memoryKV(), platform: "ANDROID", appVersion: "1.4.0", iterations: 1000 });
    await session.setPin("1234");
    let cb: (on: boolean) => void = () => {};
    const network: NetworkAdapter = { isOnline: async () => false, onChange: (c) => { cb = c; return () => {}; } };
    let now = Date.parse("2026-10-19T12:00:00Z");
    const app = new AppController({ api, store, session, network, now: () => now, intervalMs: 3_600_000 });
    await app.start();
    expect(app.getState()).toMatchObject({ status: "offline", registered: true, locked: true, needsPin: false, canCapture: false });
    expect(f.calls).toHaveLength(0);
    cb(true);
    await app.engine.sync(); // espera la sincronización disparada por la red
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.length).toBeGreaterThan(0);
    expect(app.getState()).toMatchObject({ status: "online", canCapture: true, error: null });
    expect((await app.unlock("1234")).ok).toBe(true);
    expect(app.getState().locked).toBe(false);
    now += 8 * 24 * 3600_000;
    await app.refresh();
    expect(app.getState().canCapture).toBe(false);
    app.stop();
  });
});
