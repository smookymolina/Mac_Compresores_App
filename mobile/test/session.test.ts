import { describe, expect, it } from "vitest";
import { createApiClient } from "../src/core/api";
import { MemoryStore } from "../src/core/store";
import { MAX_PIN_ATTEMPTS, OFFLINE_LIMIT_MS, PIN_ITERATIONS, Session, canCapture, hashPin, memoryKV, verifyPinHash } from "../src/core/session";
import { mockFetch } from "./helpers";

async function setup() {
  const f = mockFetch({
    "/api/sync/register": (_u, init) => {
      const b = JSON.parse(String(init.body));
      return { body: { token: "tok-1", deviceId: "dev-1", serverSeq: "42", user: { id: "u1", name: "Vendedor", email: b.email, role: "SELLER", roleName: "Vendedor", permissions: ["quotes.read_own"] } } };
    },
    "/api/sync/logout": () => ({ body: { ok: true } }),
  });
  let session: Session;
  const api = createApiClient({ baseUrl: "https://erp.test", getToken: () => session.getToken(), fetch: f.fetch });
  const store = new MemoryStore();
  await store.init();
  const secure = memoryKV(), prefs = memoryKV();
  session = new Session({ api, store, secure, prefs, platform: "ANDROID", appVersion: "1.4.0", iterations: 1000 });
  return { session, store, secure, prefs, calls: f.calls };
}

describe("PIN", () => {
  it("PBKDF2: verifica, rechaza y usa sal aleatoria; ≥150k iteraciones por omisión", async () => {
    expect(PIN_ITERATIONS).toBeGreaterThanOrEqual(150_000);
    const h = await hashPin("123456");
    expect(h.iter).toBe(PIN_ITERATIONS);
    expect(await verifyPinHash("123456", h)).toBe(true);
    expect(await verifyPinHash("654321", h)).toBe(false);
    expect((await hashPin("123456", 1000)).salt).not.toBe((await hashPin("123456", 1000)).salt);
    await expect(hashPin("12a4")).rejects.toThrow();
    await expect(hashPin("123")).rejects.toThrow();
    await expect(hashPin("1234567")).rejects.toThrow();
  });

  it("registro guarda token en almacenamiento seguro y usuario en meta", async () => {
    const { session, store, secure, calls } = await setup();
    await session.register("v@ejemplo.mx", "pw", "Pixel");
    expect(secure.dump()["device.token"]).toBe("tok-1");
    expect((await store.getMeta("user"))!.email).toBe("v@ejemplo.mx");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ platform: "ANDROID", appVersion: "1.4.0", deviceName: "Pixel" });
    expect(new Headers(calls[0]!.init.headers).get("authorization")).toBeNull();
  });

  it("5 PIN incorrectos borran todo; un acierto reinicia el contador", async () => {
    const { session, store, prefs } = await setup();
    await session.register("v@ejemplo.mx", "pw", "Pixel");
    await session.setPin("2468");
    await store.put("Customer", [{ id: "c1", legalName: "X" }]);
    expect(await session.verifyPin("0000")).toEqual({ ok: false, remaining: 4, wiped: false });
    expect(await session.verifyPin("2468")).toEqual({ ok: true });
    expect(prefs.dump()["pin.failures"]).toBeUndefined();
    let last;
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) last = await session.verifyPin("1111");
    expect(last).toEqual({ ok: false, remaining: 0, wiped: true });
    expect(await session.isRegistered()).toBe(false);
    expect(await session.hasPin()).toBe(false);
    expect(await store.count("Customer")).toBe(0);
    expect(await store.getMeta("user")).toBeNull();
  });

  it("logout revoca en el servidor y borra todo", async () => {
    const { session, calls } = await setup();
    await session.register("v@ejemplo.mx", "pw", "Pixel");
    await session.logout();
    expect(calls.at(-1)!.url.pathname).toBe("/api/sync/logout");
    expect(new Headers(calls.at(-1)!.init.headers).get("authorization")).toBe("Bearer tok-1");
    expect(await session.isRegistered()).toBe(false);
  });
});

describe("límite sin conexión", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("captura permitida ≤ 7 días, bloqueada después o sin sincronizar", () => {
    expect(canCapture(new Date(now - 60_000).toISOString(), now)).toBe(true);
    expect(canCapture(new Date(now - OFFLINE_LIMIT_MS).toISOString(), now)).toBe(true);
    expect(canCapture(new Date(now - OFFLINE_LIMIT_MS - 1).toISOString(), now)).toBe(false);
    expect(canCapture(null, now)).toBe(false);
    expect(canCapture("basura", now)).toBe(false);
  });
});
