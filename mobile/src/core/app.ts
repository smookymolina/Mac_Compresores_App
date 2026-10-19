import { Capacitor } from "@capacitor/core";
import { OfflineError, UnauthorizedError, UpgradeError, createApiClient, type ApiClient, type SessionUser, type SyncEntity } from "./api";
import { API_URL, APP_VERSION, SYNC_INTERVAL_MS } from "./config";
import { Session, prefsKV, secureKV, unlockWithBiometry, type PinResult } from "./session";
import { createDefaultStore, type LocalStore } from "./store";
import { SyncEngine } from "./sync";
import { QuoteService, type LocalQuote } from "./quotes";
import { quotePdf, shareQuotePdf, type AssetLoader } from "./pdf";

export type NetStatus = "online" | "offline" | "syncing";

export interface AppState {
  ready: boolean;
  status: NetStatus;
  /** Comandos en el outbox. */
  pending: number;
  /** Igual que `pending` (nombre usado por las pantallas). */
  pendingCount: number;
  /** Cotizaciones con conflicto o rechazo (`_sync.state`), más recientes primero. */
  conflicts: LocalQuote[];
  lastSyncAt: string | null;
  user: SessionUser | null;
  /** Hay token de dispositivo. Si es false → pantalla de alta (correo/contraseña). */
  registered: boolean;
  /** Registrado pero sin PIN configurado → pantalla «crea tu PIN». */
  needsPin: boolean;
  /** Requiere PIN/huella para ver datos. */
  locked: boolean;
  /** false si la última sincronización tiene más de 7 días (solo consulta). */
  canCapture: boolean;
  /** El servidor exige una versión más nueva (409 upgrade). */
  upgradeRequired: boolean;
  /** Último error de sincronización legible (null si la última salió bien). */
  error: string | null;
  /** Progreso de la descarga inicial (null fuera del bootstrap). */
  progress: { entity: SyncEntity; loaded: number } | null;
}

export interface NetworkAdapter {
  isOnline(): Promise<boolean>;
  onChange(cb: (online: boolean) => void): () => void;
}

export interface AppControllerOptions {
  api: ApiClient;
  store: LocalStore;
  session: Session;
  network?: NetworkAdapter;
  intervalMs?: number;
  now?: () => number;
  /** Imágenes del PDF (pruebas); por omisión `fetch` a `/brand/*`. */
  loadAsset?: AssetLoader;
}

const initial: AppState = {
  ready: false, status: "offline", pending: 0, pendingCount: 0, conflicts: [], lastSyncAt: null, user: null, registered: false,
  needsPin: false, locked: true, canCapture: false, upgradeRequired: false, error: null, progress: null,
};

/** Estado global de la app (sin React). `useApp()` lo expone a la UI. */
export class AppController {
  readonly engine: SyncEngine;
  /** Cotizaciones locales: `createQuote`, `updateQuote`, `changeStatus`, `emailQuote`, `listQuotes`, `getQuote`, `buildQuote`. */
  readonly quotes: QuoteService;
  private state: AppState = initial;
  private listeners = new Set<() => void>();
  private online = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubNet: (() => void) | null = null;

  constructor(readonly o: AppControllerOptions) {
    this.engine = new SyncEngine({ api: o.api, store: o.store, onUnauthorized: () => o.session.wipe(), onProgress: (p) => this.set({ progress: p }) });
    this.quotes = new QuoteService({
      store: o.store, now: o.now, onChange: () => this.refresh(),
      beforeWrite: async () => { await this.engine.idle(); },
    });
  }

  /** PDF (bytes) de una cotización local. */
  quotePdf = (quoteId: string) => quotePdf(this.o.store, quoteId, { loadAsset: this.o.loadAsset });
  /** Guarda el PDF en caché y abre la hoja de compartir del sistema. */
  shareQuotePdf = (quoteId: string) => shareQuotePdf(this.o.store, quoteId, { loadAsset: this.o.loadAsset });

  get api() { return this.o.api; }
  get store() { return this.o.store; }
  get session() { return this.o.session; }

  getState = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private set(p: Partial<AppState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  /** Recalcula usuario, pendientes, lastSyncAt y banderas desde el almacenamiento. */
  async refresh() {
    const { store, session } = this.o;
    const [registered, hasPin, user, pending, lastSyncAt, capture, conflicts] = await Promise.all([
      session.isRegistered(), session.hasPin(), session.user(), store.pendingCount(), store.getMeta("lastSyncAt"),
      this.quotes.canCapture(), this.quotes.listIssues(),
    ]);
    this.set({
      registered, user, pending, pendingCount: pending, conflicts, lastSyncAt, needsPin: registered && !hasPin,
      locked: registered ? this.state.locked || !hasPin : false,
      canCapture: capture,
    });
  }

  /** Al abrir: estado, red, sincronización inicial y cada 5 min. */
  async start() {
    if (this.state.ready) return;
    await this.refresh();
    const net = this.o.network;
    this.online = net ? await net.isOnline() : true;
    this.set({ ready: true, status: this.online ? "online" : "offline" });
    this.unsubNet = net?.onChange((on) => {
      const regained = on && !this.online;
      this.online = on;
      if (this.state.status !== "syncing") this.set({ status: on ? "online" : "offline" });
      if (regained) void this.syncNow();
    }) ?? null;
    this.timer = setInterval(() => void this.syncNow(), this.o.intervalMs ?? SYNC_INTERVAL_MS);
    void this.syncNow();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubNet?.();
    this.unsubNet = null;
    this.set({ ready: false });
  }

  /** Sincroniza ya (no lanza: el resultado queda en `status`/`error`). */
  async syncNow(): Promise<void> {
    if (!this.online || !(await this.o.session.isRegistered()) || this.state.upgradeRequired) return;
    this.set({ status: "syncing" });
    try {
      await this.engine.sync();
      this.set({ error: null });
    } catch (e) {
      if (e instanceof OfflineError) this.online = false;
      if (e instanceof UpgradeError) this.set({ upgradeRequired: true });
      if (e instanceof UnauthorizedError) this.set({ locked: false });
      this.set({ error: e instanceof Error ? e.message : "Error de sincronización." });
    } finally {
      this.set({ status: this.online ? "online" : "offline", progress: null });
      await this.refresh();
    }
  }

  async login(email: string, password: string, deviceName: string) {
    const r = await this.o.session.register(email, password, deviceName);
    this.online = true;
    this.set({ locked: true, upgradeRequired: false, error: null });
    await this.refresh();
    void this.syncNow();
    return r;
  }

  async setPin(pin: string) {
    await this.o.session.setPin(pin);
    this.set({ locked: false });
    await this.refresh();
  }

  async unlock(pin: string): Promise<PinResult> {
    const r = await this.o.session.verifyPin(pin);
    if (r.ok) this.set({ locked: false });
    await this.refresh();
    return r;
  }

  async unlockBiometric(): Promise<boolean> {
    if (!(await this.o.session.hasPin())) return false;
    const ok = await unlockWithBiometry();
    if (ok) this.set({ locked: false });
    return ok;
  }

  lock() { if (this.state.registered) this.set({ locked: true }); }

  async logout() {
    await this.o.session.logout();
    this.set({ locked: false, error: null });
    await this.refresh();
  }
}

/** Red con `@capacitor/network`. */
export async function capacitorNetwork(): Promise<NetworkAdapter> {
  const { Network } = await import("@capacitor/network");
  return {
    isOnline: async () => (await Network.getStatus()).connected,
    onChange: (cb) => {
      const h = Network.addListener("networkStatusChange", (s) => cb(s.connected));
      return () => { void h.then((x) => x.remove()); };
    },
  };
}

/** Arma la app con los plugins reales (teléfono) o equivalentes web (navegador). */
export async function createApp(opts: { baseUrl?: string } = {}): Promise<AppController> {
  const store = await createDefaultStore();
  const [secure, prefs, network] = await Promise.all([secureKV(), prefsKV(), capacitorNetwork()]);
  let session: Session | null = null;
  const api = createApiClient({ baseUrl: opts.baseUrl ?? API_URL, getToken: () => session!.getToken() });
  session = new Session({ api, store, secure, prefs, platform: Capacitor.getPlatform() === "ios" ? "IOS" : "ANDROID", appVersion: APP_VERSION });
  return new AppController({ api, store, session, network });
}
