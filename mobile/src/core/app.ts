import { Capacitor } from "@capacitor/core";
import { OfflineError, UnauthorizedError, UpgradeError, createApiClient, type ApiClient, type AppVersionInfo, type SessionUser, type SyncEntity } from "./api";
import { API_URL, APP_VERSION, SYNC_INTERVAL_MS } from "./config";
import { Session, prefsKV, secureKV, unlockWithBiometry, type PinResult } from "./session";
import { createDefaultStore, type LocalStore } from "./store";
import { SyncEngine, listSyncIssues, type SyncIssue } from "./sync";
import { QuoteService, type LocalQuote } from "./quotes";
import { CustomerService } from "./customers";
import { SalesService } from "./sales";
import { InventoryService } from "./inventory";
import { hasPermission, type LocalServiceOptions } from "./local";
import type { AssetLoader } from "./pdf";
import { absoluteUrl, isSystemUrl, stalePending, updateInfo, versionFor, type StalePending, type UpdateInfo } from "./update";

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
  /** Conflictos/rechazos de todas las capturas (cotizaciones, clientes, ventas, pagos, movimientos). */
  issues: SyncIssue[];
  /** Permisos del usuario de la sesión (ver `can()`). */
  permissions: string[];
  lastSyncAt: string | null;
  user: SessionUser | null;
  /** Hay token de dispositivo. Si es false → pantalla de alta (correo/contraseña). */
  registered: boolean;
  /** Registrado pero sin PIN configurado → pantalla «crea tu PIN». */
  needsPin: boolean;
  /** Requiere PIN/huella para ver datos. */
  locked: boolean;
  /** false si la última sincronización tiene más de 7 días o hay actualización obligatoria (solo consulta). */
  canCapture: boolean;
  /** Motivo legible cuando `canCapture` es false. */
  captureBlockedReason: string | null;
  /** Versión instalada vs. publicada (`/api/app/version`). */
  update: UpdateInfo;
  /** Hay una versión más nueva publicada. */
  updateAvailable: boolean;
  /** La versión mínima publicada es mayor que la instalada: se envía el outbox y luego se bloquea la captura. */
  updateRequired: boolean;
  /** Cambios en el outbox con más de 24 h sin enviarse (null si no hay). */
  stalePending: StalePending | null;
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
  /** Versión instalada (por omisión `APP_VERSION`). */
  appVersion?: string;
  /** "android" | "ios" | "web" (por omisión `Capacitor.getPlatform()`). */
  platform?: () => string;
  /** Abre una URL fuera de la app (por omisión `@capacitor/browser` en el teléfono, `window.open` en web). */
  openUrl?: (url: string) => Promise<void>;
  /** Navega el WebView (por omisión `window.location.assign`); Capacitor pasa los esquemas no web (`itms-services:`) al sistema. */
  navigate?: (url: string) => void;
}

const REQUIRED_REASON = "Hay una actualización obligatoria. Instálala para volver a capturar.";

const initial: AppState = {
  ready: false, status: "offline", pending: 0, pendingCount: 0, conflicts: [], issues: [], permissions: [], lastSyncAt: null, user: null, registered: false,
  needsPin: false, locked: true, canCapture: false, captureBlockedReason: null, upgradeRequired: false, error: null, progress: null,
  update: updateInfo(APP_VERSION, null), updateAvailable: false, updateRequired: false, stalePending: null,
};

/** Estado global de la app (sin React). `useApp()` lo expone a la UI. */
export class AppController {
  readonly engine: SyncEngine;
  /** Cotizaciones locales: `createQuote`, `updateQuote`, `changeStatus`, `emailQuote`, `listQuotes`, `getQuote`, `buildQuote`. */
  readonly quotes: QuoteService;
  /** Clientes: `createCustomer`, `updateCustomer`, `addContact`/`removeContact`, `addAddress`/`removeAddress`, `listCustomers`, `getCustomer`. */
  readonly customers: CustomerService;
  /** Ventas: `convertQuote`, `registerPayment`, `balance`, `previewStock`, `listSales`, `getSale`. */
  readonly sales: SalesService;
  /** Inventario: `registerMovement`, `listBalances`, `listMovements`. */
  readonly inventory: InventoryService;
  private state: AppState;
  private versionInfo: AppVersionInfo | null = null;
  private listeners = new Set<() => void>();
  private online = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsubNet: (() => void) | null = null;

  constructor(readonly o: AppControllerOptions) {
    this.state = { ...initial, update: updateInfo(this.current, null) };
    this.engine = new SyncEngine({ api: o.api, store: o.store, onUnauthorized: () => o.session.wipe(), onProgress: (p) => this.set({ progress: p }) });
    const svc: LocalServiceOptions = {
      store: o.store, now: o.now, onChange: () => this.refresh(),
      beforeWrite: async () => { await this.engine.idle(); },
      captureBlocked: () => (this.state.updateRequired ? REQUIRED_REASON : null),
    };
    this.quotes = new QuoteService(svc);
    this.customers = new CustomerService(svc);
    this.sales = new SalesService(svc);
    this.inventory = new InventoryService(svc);
  }

  /** ¿El usuario de la sesión tiene el permiso? (p. ej. `customers.write`, `sales.create`, `payments.write`, `inventory.write`). */
  can = (permission: string) => hasPermission(this.state.user, permission);

  /** PDF (bytes) de una cotización local. */
  quotePdf = async (quoteId: string) => (await import("./pdf")).quotePdf(this.o.store, quoteId, { loadAsset: this.o.loadAsset });
  /** Guarda el PDF en caché y abre la hoja de compartir del sistema. */
  shareQuotePdf = async (quoteId: string) => (await import("./pdf")).shareQuotePdf(this.o.store, quoteId, { loadAsset: this.o.loadAsset });

  get api() { return this.o.api; }
  private get current() { return this.o.appVersion ?? APP_VERSION; }
  private platform() { return this.o.platform?.() ?? Capacitor.getPlatform(); }
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
    const [registered, hasPin, user, pending, lastSyncAt, capture, conflicts, issues, oldest, savedVersion] = await Promise.all([
      session.isRegistered(), session.hasPin(), session.user(), store.pendingCount(), store.getMeta("lastSyncAt"),
      this.quotes.canCapture(), this.quotes.listIssues(), listSyncIssues(store), store.outbox(1), store.getMeta("appVersion"),
    ]);
    if (!this.versionInfo && savedVersion) {
      // Sin red al abrir: se usa la última versión conocida (una obligatoria sigue bloqueando la captura).
      this.versionInfo = savedVersion;
      const u = updateInfo(this.current, versionFor(this.platform(), savedVersion));
      this.set({ update: u, updateAvailable: u.available, updateRequired: u.required });
    }
    const now = this.o.now?.() ?? Date.now();
    const blocked = this.state.updateRequired ? REQUIRED_REASON : !capture ? "Llevas demasiados días sin sincronizar. Solo puedes consultar hasta que sincronices." : null;
    this.set({
      registered, user, pending, pendingCount: pending, conflicts, issues, permissions: user?.permissions ?? [], lastSyncAt, needsPin: registered && !hasPin,
      locked: registered ? this.state.locked || !hasPin : false,
      canCapture: !blocked, captureBlockedReason: blocked,
      stalePending: stalePending(oldest[0]?.queuedAt, pending, now),
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

  /**
   * Consulta `/api/app/version` (público, mejor esfuerzo). Actualiza `update`/`updateAvailable`;
   * `updateRequired` solo se activa aquí si no hay nada por enviar (si no, `syncNow` envía el outbox primero).
   */
  async checkUpdate(): Promise<UpdateInfo> {
    try {
      const v = await this.o.api.version();
      this.versionInfo = v;
      await this.o.store.setMeta("appVersion", v);
    } catch { /* sin red: se conserva lo último conocido */ }
    const u = updateInfo(this.current, versionFor(this.platform(), this.versionInfo));
    this.set({ update: u, updateAvailable: u.available, ...(!u.required && { updateRequired: false }) });
    if (u.required && !this.state.updateRequired && (await this.o.store.pendingCount()) === 0) {
      this.set({ updateRequired: true });
      await this.refresh();
    }
    return u;
  }

  /** Sincroniza ya (no lanza: el resultado queda en `status`/`error`). */
  async syncNow(): Promise<void> {
    if (!this.online) return;
    const u = await this.checkUpdate();
    if (!(await this.o.session.isRegistered()) || this.state.upgradeRequired) {
      if (u.required && !this.state.updateRequired) { this.set({ updateRequired: true }); await this.refresh(); }
      return;
    }
    this.set({ status: "syncing" });
    try {
      await this.engine.sync();
      // Actualización obligatoria: enviar TODO el outbox antes de bloquear la captura.
      if (u.required) await this.drainOutbox();
      this.set({ error: null });
    } catch (e) {
      if (e instanceof OfflineError) this.online = false;
      if (e instanceof UpgradeError) this.set({ upgradeRequired: true });
      if (e instanceof UnauthorizedError) this.set({ locked: false });
      this.set({ error: e instanceof Error ? e.message : "Error de sincronización." });
    } finally {
      if (u.required) this.set({ updateRequired: true });
      this.set({ status: this.online ? "online" : "offline", progress: null });
      await this.refresh();
    }
  }

  /** Envía el outbox en lotes hasta vaciarlo o hasta que el servidor pida reintentar. */
  private async drainOutbox() {
    for (let i = 0; i < 20 && (await this.o.store.pendingCount()) > 0; i++) {
      const r = await this.engine.push();
      if (r.stopped || r.sent === 0) break;
    }
  }

  /**
   * Abre la descarga de la versión nueva.
   * Android: pide un enlace firmado (`/api/sync/app-download`) y lo abre en el navegador del sistema
   * (Android ofrece instalar encima; misma firma → se conservan los datos).
   * iOS: pide `{platform:"ios"}` → `itms-services://…` (instalación OTA Ad Hoc/Enterprise); si no hay IPA
   * publicado (404) o falla, usa `iosUrl` (p. ej. enlace de TestFlight). Web: `window.open`.
   */
  async startUpdate(): Promise<void> {
    const base = this.o.api.baseUrl;
    const v = this.versionInfo ?? (await this.checkUpdate(), this.versionInfo);
    const platform = this.platform();
    let url: string | null = null;
    if (platform === "ios") {
      try { url = (await this.o.api.appDownload("ios")).url; } catch { url = v?.iosUrl ?? null; }
    } else if (platform === "android") {
      try { url = (await this.o.api.appDownload()).url; } catch { url = v?.androidUrl ?? null; }
    } else url = v?.androidUrl ?? null;
    if (!url) throw new Error("No hay enlace de descarga. Pide la actualización a tu administrador.");
    await this.openUrl(absoluteUrl(base, url), platform);
  }

  private async openUrl(url: string, platform: string) {
    // itms-services:// no lo abre SFSafariViewController: se navega el WebView y Capacitor lo entrega a iOS.
    if (isSystemUrl(url)) { (this.o.navigate ?? ((u: string) => window.location.assign(u)))(url); return; }
    if (this.o.openUrl) return this.o.openUrl(url);
    if (platform === "web") { window.open(url, "_blank", "noopener"); return; }
    const { Browser } = await import("@capacitor/browser");
    await Browser.open({ url });
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
