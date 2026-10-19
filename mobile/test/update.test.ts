import { describe, expect, it, vi } from "vitest";

const browserOpen = vi.fn(async (_o: { url: string }) => {});
vi.mock("@capacitor/browser", () => ({ Browser: { open: browserOpen } }));

import { createApiClient, type SyncCommand } from "../src/core/api";
import { AppController } from "../src/core/app";
import { MemoryStore } from "../src/core/store";
import { Session, memoryKV } from "../src/core/session";
import { compareSemver, isSystemUrl, stalePending, updateInfo, versionFor } from "../src/core/update";
import { mockFetch, uuid } from "./helpers";

const version = (latest: string, minimum: string) => ({
  body: { latest, minimum, androidUrl: "/app/descargar", iosUrl: "https://apps.apple.com/x", notes: "Mejoras", sha256: "ab", size: 1, publishedAt: "2026-10-01T00:00:00Z" },
});
const cmd = (n: number): SyncCommand => ({ id: uuid(n), type: "quote.status", capturedAt: "2026-10-19T00:00:00Z", payload: { quoteId: "q", status: "SENT" } });

async function setup(routes: Parameters<typeof mockFetch>[0], o: { now?: () => number; platform?: string; pending?: number; navigate?: (u: string) => void } = {}) {
  const f = mockFetch({ "/api/sync/pull": (u) => ({ body: { changes: [], cursor: u.searchParams.get("cursor"), hasMore: false } }), ...routes });
  let session: Session;
  const api = createApiClient({ baseUrl: "https://erp.test", getToken: () => session.getToken(), fetch: f.fetch });
  const store = new MemoryStore();
  await store.init();
  await store.setMeta("cursor", "10");
  await store.setMeta("lastSyncAt", new Date(o.now?.() ?? Date.now()).toISOString());
  for (let i = 1; i <= (o.pending ?? 0); i++) await store.enqueue(cmd(i));
  session = new Session({ api, store, secure: memoryKV({ "device.token": "t" }), prefs: memoryKV(), platform: "ANDROID", appVersion: "1.4.0", iterations: 1000 });
  await session.setPin("1234");
  const app = new AppController({ api, store, session, appVersion: "1.4.0", now: o.now, intervalMs: 3_600_000, platform: () => o.platform ?? "android", navigate: o.navigate });
  return { app, store, f };
}

describe("compareSemver", () => {
  it("ordena mayor/menor/parche y prerelease", () => {
    expect(compareSemver("1.4.0", "1.4.0")).toBe(0);
    expect(compareSemver("1.10.0", "1.9.9")).toBeGreaterThan(0);
    expect(compareSemver("1.4.0", "1.4.1")).toBeLessThan(0);
    expect(compareSemver("2.0.0", "1.99.99")).toBeGreaterThan(0);
    expect(compareSemver("v1.4.0", "1.4")).toBe(0);
    expect(compareSemver("1.5.0-beta.1", "1.5.0")).toBeLessThan(0);
    expect(updateInfo("1.4.0", { latest: "1.5.0", minimum: "1.4.0", notes: "" })).toMatchObject({ available: true, required: false });
    expect(updateInfo("1.4.0", { latest: "1.5.0", minimum: "1.5.0", notes: "" })).toMatchObject({ available: true, required: true });
  });
});

describe("actualizaciones", () => {
  it("latest > actual → updateAvailable; captura sigue permitida", async () => {
    const { app } = await setup({ "/api/app/version": () => version("1.5.0", "1.3.0") });
    await app.start();
    await app.engine.idle();
    await vi.waitFor(() => expect(app.getState().updateAvailable).toBe(true));
    expect(app.getState()).toMatchObject({ updateRequired: false, canCapture: true, update: { current: "1.4.0", latest: "1.5.0", notes: "Mejoras" } });
    app.stop();
  });

  it("minimum > actual → envía el outbox ANTES de bloquear la captura; consulta permitida", async () => {
    let stateAtPush: boolean | null = null;
    let app!: AppController;
    const s = await setup({
      "/api/app/version": () => version("1.5.0", "1.5.0"),
      "/api/sync/push": (_u, init) => {
        stateAtPush = app.getState().updateRequired;
        const { commands } = JSON.parse(String(init.body)) as { commands: SyncCommand[] };
        return { body: { results: commands.map((c) => ({ id: c.id, status: "APPLIED" })) } };
      },
    }, { pending: 2 });
    app = s.app;
    await app.start();
    await vi.waitFor(() => expect(app.getState().updateRequired).toBe(true));
    app.stop();
    expect(stateAtPush).toBe(false);
    expect(await s.store.pendingCount()).toBe(0);
    expect(app.getState()).toMatchObject({ updateRequired: true, canCapture: false, pendingCount: 0 });
    expect(app.getState().captureBlockedReason).toMatch(/actualización obligatoria/i);
    await expect(app.quotes.createQuote({} as never)).rejects.toThrow(/actualización obligatoria/i);
    expect(Array.isArray(await app.quotes.listQuotes())).toBe(true);
  });

  it("startUpdate (Android) pide app-download y abre la URL con el origen del API", async () => {
    browserOpen.mockClear();
    const { app, f } = await setup({
      "/api/app/version": () => version("1.5.0", "1.0.0"),
      "/api/sync/app-download": () => ({ body: { url: "/api/app/download/android?t=abc", expiresAt: "2026-10-19T12:10:00Z" } }),
    });
    await app.startUpdate();
    const dl = f.calls.find((c) => c.url.pathname === "/api/sync/app-download");
    expect(dl?.init.method).toBe("POST");
    expect((dl?.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(browserOpen).toHaveBeenCalledWith({ url: "https://erp.test/api/app/download/android?t=abc" });
  });

  it("startUpdate (iOS) sin IPA publicado (404) abre iosUrl", async () => {
    browserOpen.mockClear();
    const navigate = vi.fn();
    const { app, f } = await setup({
      "/api/app/version": () => version("1.5.0", "1.0.0"),
      "/api/sync/app-download": () => ({ status: 404, body: { error: "No hay IPA" } }),
    }, { platform: "ios", navigate });
    await app.startUpdate();
    const dl = f.calls.find((c) => c.url.pathname === "/api/sync/app-download");
    expect(JSON.parse(String(dl?.init.body))).toEqual({ platform: "ios" });
    expect(browserOpen).toHaveBeenCalledWith({ url: "https://apps.apple.com/x" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("startUpdate (iOS) con IPA: navega a itms-services (no Browser.open)", async () => {
    browserOpen.mockClear();
    const navigate = vi.fn();
    const itms = "itms-services://?action=download-manifest&url=https%3A%2F%2Ferp.test%2Fapi%2Fapp%2Fmanifest.plist%3Ft%3Dabc";
    const { app, f } = await setup({
      "/api/app/version": () => version("1.5.0", "1.0.0"),
      "/api/sync/app-download": (_u, init) => ({ body: JSON.parse(String(init.body)).platform === "ios" ? { url: itms, expiresAt: "2026-10-19T12:10:00Z" } : { url: "/apk" } }),
    }, { platform: "ios", navigate });
    await app.startUpdate();
    expect(navigate).toHaveBeenCalledWith(itms);
    expect(browserOpen).not.toHaveBeenCalled();
    expect((f.calls.find((c) => c.url.pathname === "/api/sync/app-download")?.init.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("checkUpdate en iOS compara contra ios.latest si existe", async () => {
    const withIos = (ios: unknown) => ({ body: { ...version("1.6.0", "1.5.0").body, ios } });
    let r = await setup({ "/api/app/version": () => withIos({ latest: "1.4.0" }) }, { platform: "ios" });
    let u = await r.app.checkUpdate();
    expect(u).toMatchObject({ latest: "1.4.0", available: false, required: false });
    r = await setup({ "/api/app/version": () => withIos({ latest: "1.4.2", minimum: "1.4.1", notes: "iOS" }) }, { platform: "ios" });
    u = await r.app.checkUpdate();
    expect(u).toMatchObject({ latest: "1.4.2", available: true, required: true, notes: "iOS" });
    r = await setup({ "/api/app/version": () => withIos(null) }, { platform: "ios" });
    expect(await r.app.checkUpdate()).toMatchObject({ latest: "1.6.0", available: true, required: true });
    r = await setup({ "/api/app/version": () => withIos({ latest: "1.4.0" }) }, { platform: "android" });
    expect(await r.app.checkUpdate()).toMatchObject({ latest: "1.6.0", required: true });
  });

  it("versionFor / isSystemUrl", () => {
    const v = { latest: "2.0.0", minimum: "1.9.0", notes: "a", ios: { latest: "1.8.0" } };
    expect(versionFor("android", v)).toBe(v);
    expect(versionFor("ios", v)).toEqual({ latest: "1.8.0", minimum: "1.8.0", notes: "a" });
    expect(versionFor("ios", { ...v, ios: null })).toMatchObject({ latest: "2.0.0", minimum: "1.9.0" });
    expect(isSystemUrl("itms-services://?action=download-manifest&url=x")).toBe(true);
    expect(isSystemUrl("https://testflight.apple.com/join/x")).toBe(false);
    expect(isSystemUrl("/api/app/download")).toBe(false);
  });
});

describe("pendientes viejos", () => {
  it("stalePending: el más antiguo con más de 24 h", async () => {
    const t = Date.parse("2026-10-19T12:00:00Z");
    expect(stalePending("2026-10-18T11:59:00Z", 3, t)).toEqual({ count: 3, since: "2026-10-18T11:59:00Z" });
    expect(stalePending("2026-10-18T12:30:00Z", 3, t)).toBeNull();
    expect(stalePending(null, 0, t)).toBeNull();
    let now = Date.now();
    const { app } = await setup({}, { now: () => now, pending: 2 });
    await app.refresh();
    expect(app.getState().stalePending).toBeNull();
    now += 25 * 3600_000;
    await app.refresh();
    expect(app.getState().stalePending).toMatchObject({ count: 2 });
  });
});
