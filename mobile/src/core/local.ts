import { AppError } from "@domain/errors";
import type { SessionUser, SyncCommand, SyncCommandType, SyncConfig } from "./api";
import { CaptureBlockedError, type QuoteSync } from "./quotes";
import { OFFLINE_LIMIT_MS, canCapture } from "./session";
import type { LocalStore } from "./store";

/** `_sync` de cualquier entidad capturada en el teléfono (misma forma que el de cotizaciones). */
export type EntitySync = QuoteSync;

/** El usuario no tiene el permiso requerido (se valida también en el servidor). */
export class PermissionError extends AppError {
  constructor(message = "No tienes permiso para esta operación.") {
    super(message, "FORBIDDEN");
    this.name = "PermissionError";
  }
}
/** Regla de negocio local incumplida (mensaje listo para mostrar). */
export class LocalRuleError extends AppError {
  constructor(message: string) {
    super(message);
    this.name = "LocalRuleError";
  }
}

/** ¿El usuario tiene el permiso `p`? (lista de `SessionUser.permissions`). */
export const hasPermission = (user: Pick<SessionUser, "permissions"> | null | undefined, p: string) => !!user?.permissions?.includes(p);

export interface LocalServiceOptions {
  store: LocalStore;
  /** Se llama tras cada cambio local (para refrescar pendientes/conflictos en la UI). */
  onChange?: () => void | Promise<void>;
  /** Espera a que termine un push en curso antes de reescribir el outbox. */
  beforeWrite?: () => Promise<void>;
  /** Motivo por el que la captura está bloqueada aunque haya sincronización reciente (p. ej. actualización obligatoria). */
  captureBlocked?: () => string | null;
  now?: () => number;
  uuid?: () => string;
}

/** Base de los servicios locales (clientes, ventas, inventario): sesión, permisos, captura y outbox. */
export abstract class LocalService {
  constructor(protected o: LocalServiceOptions) {}

  protected now() { return this.o.now?.() ?? Date.now(); }
  protected nowIso() { return new Date(this.now()).toISOString(); }
  protected uuid() { return this.o.uuid?.() ?? crypto.randomUUID(); }
  protected async user(): Promise<SessionUser> {
    const u = await this.o.store.getMeta("user");
    if (!u) throw new LocalRuleError("Sin sesión.");
    return u;
  }
  async can(p: string): Promise<boolean> { return hasPermission(await this.o.store.getMeta("user"), p); }
  protected async require(p: string, message?: string) {
    if (!(await this.can(p))) throw new PermissionError(message);
  }

  /** ¿Se puede capturar? (última sincronización ≤ `maxOfflineDays`, por omisión 7). */
  async canCapture(): Promise<boolean> {
    const [last, cfg] = await Promise.all([this.o.store.getMeta("lastSyncAt"), this.o.store.getMeta("config") as Promise<SyncConfig | null>]);
    const limit = cfg?.maxOfflineDays ? cfg.maxOfflineDays * 86_400_000 : OFFLINE_LIMIT_MS;
    return canCapture(last, this.now(), limit);
  }
  protected async assertCapture() {
    const blocked = this.o.captureBlocked?.();
    if (blocked) throw new CaptureBlockedError(blocked);
    if (!(await this.canCapture())) throw new CaptureBlockedError("Llevas demasiados días sin sincronizar. Conéctate para volver a capturar.");
  }

  protected async enqueue(type: SyncCommandType, payload: Record<string, unknown>): Promise<SyncCommand> {
    const cmd: SyncCommand = { id: this.uuid(), type, capturedAt: this.nowIso(), payload };
    await this.o.store.enqueue(cmd);
    return cmd;
  }
  protected async changed() { await this.o.onChange?.(); }

  /** `_sync` pendiente para el comando recién encolado. */
  protected pending(prev: EntitySync | undefined, cmd: SyncCommand, onServer: boolean): EntitySync {
    return { ...(prev ?? { onServer }), state: "pending", commandId: cmd.id, commandType: cmd.type, onServer: prev?.onServer ?? onServer, error: undefined, conflict: undefined };
  }
}

/** "  x " → "x"; "" → null. */
export const clean = (s: string | null | undefined) => (s ?? "").trim() || null;
