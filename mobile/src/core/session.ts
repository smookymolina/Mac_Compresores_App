import type { ApiClient, RegisterResponse, SessionUser } from "./api";
import type { LocalStore } from "./store";

/** Almacén clave/valor asíncrono (inyectable en pruebas). */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const MAX_PIN_ATTEMPTS = 5;
export const PIN_ITERATIONS = 210_000;
export const OFFLINE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
const K = { token: "device.token", pin: "pin.hash", fails: "pin.failures" } as const;

// ---------- PIN (PBKDF2-SHA256, WebCrypto) ----------

export interface PinHash { v: 1; iter: number; salt: string; hash: string }

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const isValidPin = (pin: string) => /^\d{4,6}$/.test(pin);

async function derive(pin: string, salt: Uint8Array, iter: number) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iter = PIN_ITERATIONS): Promise<PinHash> {
  if (!isValidPin(pin)) throw new Error("El PIN debe tener de 4 a 6 dígitos.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { v: 1, iter, salt: b64(salt), hash: b64(await derive(pin, salt, iter)) };
}

export async function verifyPinHash(pin: string, h: PinHash): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const got = await derive(pin, unb64(h.salt), h.iter);
  const want = unb64(h.hash);
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i]! ^ want[i]!;
  return diff === 0;
}

// ---------- Límite sin conexión ----------

/** Capturas permitidas solo si la última sincronización tiene ≤ 7 días. Consultar siempre se permite. */
export function canCapture(lastSyncAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!lastSyncAt) return false;
  const t = Date.parse(lastSyncAt);
  return Number.isFinite(t) && now - t <= OFFLINE_LIMIT_MS;
}

// ---------- Sesión ----------

export type PinResult = { ok: true } | { ok: false; remaining: number; wiped: boolean };

export interface SessionOptions {
  api: Pick<ApiClient, "register" | "logout">;
  store: LocalStore;
  /** Token del dispositivo: Keystore/Keychain. */
  secure: KV;
  /** Hash del PIN y contador de fallos: Preferences. */
  prefs: KV;
  platform: "ANDROID" | "IOS";
  appVersion: string;
  iterations?: number;
}

export class Session {
  private token: string | null | undefined;
  constructor(private o: SessionOptions) {}

  async getToken(): Promise<string | null> {
    if (this.token === undefined) this.token = await this.o.secure.get(K.token);
    return this.token;
  }
  async isRegistered() { return (await this.getToken()) !== null; }
  async hasPin() { return (await this.o.prefs.get(K.pin)) !== null; }
  user(): Promise<SessionUser | null> { return this.o.store.getMeta("user"); }

  /** Alta del dispositivo con correo y contraseña (requiere red). Después: `setPin()`. */
  async register(email: string, password: string, deviceName: string): Promise<RegisterResponse> {
    await this.wipe();
    const r = await this.o.api.register({ email, password, deviceName, platform: this.o.platform, appVersion: this.o.appVersion });
    await this.o.secure.set(K.token, r.token);
    this.token = r.token;
    await this.o.store.setMeta("user", r.user);
    await this.o.store.setMeta("deviceId", r.deviceId);
    return r;
  }

  async setPin(pin: string) {
    const h = await hashPin(pin, this.o.iterations);
    await this.o.prefs.set(K.pin, JSON.stringify(h));
    await this.o.prefs.remove(K.fails);
  }

  /** Verifica el PIN; al 5.º fallo seguido borra todo y obliga a volver a entrar con correo. */
  async verifyPin(pin: string): Promise<PinResult> {
    const raw = await this.o.prefs.get(K.pin);
    if (!raw) return { ok: false, remaining: 0, wiped: false };
    if (await verifyPinHash(pin, JSON.parse(raw) as PinHash)) {
      await this.o.prefs.remove(K.fails);
      return { ok: true };
    }
    const fails = Number((await this.o.prefs.get(K.fails)) ?? 0) + 1;
    if (fails >= MAX_PIN_ATTEMPTS) {
      await this.wipe();
      return { ok: false, remaining: 0, wiped: true };
    }
    await this.o.prefs.set(K.fails, String(fails));
    return { ok: false, remaining: MAX_PIN_ATTEMPTS - fails, wiped: false };
  }

  /** Cierra sesión: revoca en el servidor si hay red (mejor esfuerzo) y borra todo. */
  async logout() {
    try { if (await this.getToken()) await this.o.api.logout(); } catch { /* sin red: el admin puede revocar desde la web */ }
    await this.wipe();
  }

  /** Borra token, PIN, contador y datos locales. */
  async wipe() {
    await this.o.secure.remove(K.token);
    await this.o.prefs.remove(K.pin);
    await this.o.prefs.remove(K.fails);
    this.token = null;
    await this.o.store.wipe();
  }
}

// ---------- KV por defecto (plugins) ----------

/** Token en Android Keystore / iOS Keychain (`@aparajita/capacitor-secure-storage`). */
export async function secureKV(): Promise<KV> {
  const { SecureStorage } = await import("@aparajita/capacitor-secure-storage");
  await SecureStorage.setKeyPrefix("maccampo_");
  return {
    get: async (k) => { const v = await SecureStorage.get(k); return typeof v === "string" ? v : null; },
    set: async (k, v) => { await SecureStorage.set(k, v); },
    remove: async (k) => { await SecureStorage.remove(k); },
  };
}

/** `@capacitor/preferences` (no secreto: hash del PIN y contador). */
export async function prefsKV(): Promise<KV> {
  const { Preferences } = await import("@capacitor/preferences");
  return {
    get: async (key) => (await Preferences.get({ key })).value,
    set: async (key, value) => { await Preferences.set({ key, value }); },
    remove: async (key) => { await Preferences.remove({ key }); },
  };
}

/** KV en memoria (pruebas / navegador). */
export function memoryKV(init: Record<string, string> = {}): KV & { dump(): Record<string, string> } {
  const m = new Map(Object.entries(init));
  return {
    get: async (k) => m.get(k) ?? null,
    set: async (k, v) => { m.set(k, v); },
    remove: async (k) => { m.delete(k); },
    dump: () => Object.fromEntries(m),
  };
}

// ---------- Biometría (opcional) ----------

/** ¿Hay huella/rostro disponible? (`@aparajita/capacitor-biometric-auth`). */
export async function biometryAvailable(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch { return false; }
}

/**
 * Desbloqueo con huella como alternativa al PIN (el PIN sigue siendo obligatorio como respaldo).
 * Devuelve false si el usuario cancela o falla.
 */
export async function unlockWithBiometry(reason = "Desbloquear MAC Campo"): Promise<boolean> {
  try {
    const { BiometricAuth } = await import("@aparajita/capacitor-biometric-auth");
    await BiometricAuth.authenticate({ reason, cancelTitle: "Usar PIN", allowDeviceCredential: false, androidTitle: "MAC Campo", androidSubtitle: reason });
    return true;
  } catch { return false; }
}
