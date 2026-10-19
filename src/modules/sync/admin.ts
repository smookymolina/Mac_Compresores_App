import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";
import { notify } from "@/modules/notifications/service";
import { loadCurrentUser } from "./device";
import { applyCommand, type PriceMode } from "./push";
import { SyncConflictError } from "./conflicts";
import { syncCommandSchema, type ConflictResult, type SyncCommand } from "./protocol";

/**
 * Activa o quita el acceso a la app móvil. Al quitarlo se revocan en la misma transacción
 * los dispositivos activos del usuario (su token deja de servir en la siguiente petición).
 */
export async function setMobileAccess(actor: CurrentUser, userId: string, enabled: boolean) {
  assertCan(actor, "users.manage");
  return db.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { id: true, mobileAccess: true } });
    if (!u) throw new AppError("Usuario no encontrado.", "NOT_FOUND");
    await tx.user.update({ where: { id: userId }, data: { mobileAccess: enabled } });
    let revoked = 0;
    if (!enabled) {
      ({ count: revoked } = await tx.device.updateMany({
        where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id },
      }));
    }
    await audit({ userId: actor.id, action: "user.mobile_access", entity: "User", entityId: userId,
      data: { from: u.mobileAccess, to: enabled, devicesRevoked: revoked } }, tx);
    return { revoked };
  });
}

/** Revoca un dispositivo. Guarda de estado: solo si sigue activo. */
export async function revokeDevice(actor: CurrentUser, deviceId: string) {
  assertCan(actor, "users.manage");
  await db.$transaction(async (tx) => {
    const { count } = await tx.device.updateMany({
      where: { id: deviceId, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id },
    });
    if (count === 0) {
      const exists = await tx.device.findUnique({ where: { id: deviceId }, select: { id: true } });
      throw exists ? new AppError("El dispositivo ya estaba revocado.", "CONFLICT") : new AppError("Dispositivo no encontrado.", "NOT_FOUND");
    }
    await audit({ userId: actor.id, action: "device.revoke", entity: "Device", entityId: deviceId }, tx);
  });
}

export async function listDevices() {
  return db.device.findMany({
    select: {
      id: true, name: true, platform: true, appVersion: true, createdAt: true, lastSeenAt: true, revokedAt: true,
      user: { select: { id: true, name: true } },
    },
    orderBy: [{ revokedAt: { sort: "asc", nulls: "first" } }, { lastSeenAt: { sort: "desc", nulls: "last" } }],
  });
}

/** Comandos rechazados o en conflicto que nadie ha revisado, más recientes primero. */
export async function listSyncIssues({ take = 100 }: { take?: number } = {}) {
  const items = await db.syncCommand.findMany({
    where: { status: { in: ["REJECTED", "CONFLICT"] }, resolvedAt: null },
    select: {
      id: true, type: true, status: true, error: true, result: true, capturedAt: true, receivedAt: true, userId: true,
      device: { select: { name: true, revokedAt: true } },
    },
    orderBy: { receivedAt: "desc" },
    take,
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  const whIds = [...new Set(items.map((i) => asConflict(i.status, i.result)).flatMap((c) => (c?.kind === "stock" ? [c.warehouseId] : [])))];
  const whs = await db.warehouse.findMany({ where: { id: { in: whIds } }, select: { id: true, code: true, name: true } });
  const whName = new Map(whs.map((w) => [w.id, `${w.code} · ${w.name}`]));
  return items.map(({ result, ...i }) => {
    const conflict = asConflict(i.status, result);
    return {
      ...i, conflict, priceConflict: conflict?.kind === "price" ? conflict : null,
      warehouseName: conflict?.kind === "stock" ? whName.get(conflict.warehouseId) ?? null : null,
      userName: names.get(i.userId) ?? null,
    };
  });
}

/** Marca una incidencia como revisada. Guarda de estado: solo si sigue sin resolver. */
export async function resolveSyncIssue(actor: CurrentUser, id: string) {
  assertCan(actor, "users.manage");
  await db.$transaction(async (tx) => {
    const { count } = await tx.syncCommand.updateMany({
      where: { id, resolvedAt: null, status: { in: ["REJECTED", "CONFLICT"] } },
      data: { resolvedAt: new Date(), resolvedById: actor.id },
    });
    if (count === 0) throw new AppError("La incidencia no existe o ya fue revisada.", "CONFLICT");
    await audit({ userId: actor.id, action: "sync.issue_resolved", entity: "SyncCommand", entityId: id }, tx);
  });
}

const CONFLICT_KINDS = new Set(["price", "stock", "duplicate_rfc"]);
const asConflict = (status: string, r: unknown): ConflictResult | null =>
  status === "CONFLICT" && typeof r === "object" && r !== null && CONFLICT_KINDS.has(String((r as { kind?: unknown }).kind)) ? (r as ConflictResult) : null;

type PendingConflict = Prisma.SyncCommandGetPayload<{ include: { device: true } }>;

/** Conflicto pendiente (CONFLICT sin resolver) o error. */
async function pendingConflict(commandId: string): Promise<PendingConflict> {
  const c = await db.syncCommand.findUnique({ where: { id: commandId }, include: { device: true } });
  if (!c) throw new AppError("Incidencia no encontrada.", "NOT_FOUND");
  if (c.status !== "CONFLICT" || c.resolvedAt) throw new AppError("La incidencia no es un conflicto pendiente.", "CONFLICT");
  return c;
}

const claim = (actor: CurrentUser, commandId: string) => (tx: Prisma.TransactionClient) => tx.syncCommand.updateMany({
  where: { id: commandId, status: "CONFLICT", resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actor.id },
});

/**
 * Vuelve a aplicar el comando guardado como el usuario del dispositivo (sus permisos y scopes).
 * No se permite si el dispositivo fue revocado o el vendedor perdió el acceso móvil. Se reclama el comando
 * (guarda CONFLICT sin resolver) antes de aplicarlo; si vuelve a fallar se libera y, si es otro conflicto,
 * se actualiza su detalle (p. ej. existencias nuevas).
 */
async function rerun(actor: CurrentUser, c: PendingConflict, edit: (cmd: SyncCommand) => SyncCommand, mode: PriceMode = "grace") {
  if (c.device.revokedAt) throw new AppError("El dispositivo fue revocado; la operación ya no se puede aplicar. Recházala.", "CONFLICT");
  const parsed = syncCommandSchema.safeParse(c.payload);
  if (!parsed.success) throw new AppError("El comando guardado no se puede volver a aplicar.");
  const user = await loadCurrentUser(c.userId);
  if (!user) throw new AppError("El vendedor ya no tiene acceso a la app móvil.", "CONFLICT");
  const cmd = edit(parsed.data);
  if ((await db.$transaction(claim(actor, c.id))).count === 0) throw new AppError("La incidencia ya fue resuelta.", "CONFLICT");
  try {
    return await applyCommand(user, c.device, cmd, mode);
  } catch (e) {
    const release = { resolvedAt: null, resolvedById: null };
    await db.syncCommand.updateMany({
      where: { id: c.id, status: "CONFLICT", resolvedById: actor.id },
      data: e instanceof SyncConflictError ? { ...release, error: e.message, result: e.result as unknown as Prisma.InputJsonObject } : release,
    });
    if (e instanceof SyncConflictError) throw new AppError(`Sigue sin poder aplicarse: ${e.message}`, "CONFLICT");
    throw e;
  }
}

async function markApplied(actor: CurrentUser, commandId: string, result: Prisma.InputJsonObject, action: string, data: Prisma.InputJsonObject) {
  await db.$transaction(async (tx) => {
    await tx.syncCommand.update({ where: { id: commandId }, data: { status: "APPLIED", result, error: null } });
    await audit({ userId: actor.id, action, entity: "SyncCommand", entityId: commandId, data }, tx);
  });
}

export type PriceResolution = "server" | "client" | "reject";

const RESOLUTION_TEXT: Record<PriceResolution, string> = {
  server: "se aplicó con los precios vigentes",
  client: "se aplicó con los precios que mostró tu teléfono",
  reject: "fue rechazada por gerencia",
};

/**
 * Resuelve un conflicto de precios (§5.3). `server` vuelve a aplicar el comando con los precios vigentes,
 * `client` con los del teléfono (requiere `quotes.override_price`), `reject` lo descarta. El comando se aplica
 * como el usuario del dispositivo (sus scopes); no si el dispositivo fue revocado.
 */
export async function resolvePriceConflict(actor: CurrentUser, commandId: string, mode: PriceResolution) {
  assertCan(actor, "users.manage");
  if (mode === "client") assertCan(actor, "quotes.override_price");
  const c = await db.syncCommand.findUnique({ where: { id: commandId }, include: { device: true } });
  if (!c) throw new AppError("Incidencia no encontrada.", "NOT_FOUND");
  if (c.resolvedAt || asConflict(c.status, c.result)?.kind !== "price") throw new AppError("La incidencia no es un conflicto de precios pendiente.", "CONFLICT");

  let result: Prisma.InputJsonObject | undefined;
  if (mode === "reject") {
    await rejectClaimed(actor, commandId, "Rechazado por gerencia (conflicto de precios).", "sync.price_conflict_resolved", { mode });
  } else {
    const type = (c.payload as { type?: unknown } | null)?.type;
    if (type !== "quote.create" && type !== "quote.update") throw new AppError("El comando guardado no se puede volver a aplicar.");
    result = await rerun(actor, c, (x) => x, mode);
    await markApplied(actor, commandId, result, "sync.price_conflict_resolved", { mode, quoteId: (result.id as string | undefined) ?? null });
  }
  const quoteId = typeof result?.id === "string" ? result.id : null;
  await notify([c.userId], {
    kind: "sync.price_conflict", title: "Conflicto de precios resuelto",
    body: `Tu cotización capturada sin conexión ${RESOLUTION_TEXT[mode]}.`,
    href: quoteId ? `/cotizaciones/${quoteId}` : undefined,
  });
  return { status: mode === "reject" ? "REJECTED" : "APPLIED", result };
}

async function rejectClaimed(actor: CurrentUser, commandId: string, error: string, action: string, data: Prisma.InputJsonObject) {
  await db.$transaction(async (tx) => {
    if ((await claim(actor, commandId)(tx)).count === 0) throw new AppError("La incidencia ya fue resuelta.", "CONFLICT");
    await tx.syncCommand.update({ where: { id: commandId }, data: { status: "REJECTED", error } });
    await audit({ userId: actor.id, action, entity: "SyncCommand", entityId: commandId, data }, tx);
  });
}

const TYPE_TEXT: Record<string, string> = {
  "sale.convert": "Tu venta capturada sin conexión", "inventory.movement": "Tu movimiento de inventario capturado sin conexión",
  "customer.save": "Tu cliente capturado sin conexión",
};
const typeText = (t: string) => TYPE_TEXT[t] ?? "Tu operación capturada sin conexión";

function appliedHref(type: string, result: Prisma.InputJsonObject) {
  const id = typeof result.id === "string" ? result.id : null;
  if (!id) return undefined;
  if (type === "sale.convert") return `/ventas/${id}`;
  if (type === "customer.save") return `/clientes/${id}`;
  if (type.startsWith("quote.")) return `/cotizaciones/${id}`;
  return undefined;
}

/**
 * «Reintentar» (cualquier conflicto) o «Convertir desde otro almacén» (`warehouseId`, solo conflicto de
 * existencias de `sale.convert`): vuelve a aplicar el comando como el vendedor y notifica el resultado.
 */
export async function retrySyncConflict(actor: CurrentUser, commandId: string, opts: { warehouseId?: string } = {}) {
  assertCan(actor, "users.manage");
  const c = await pendingConflict(commandId);
  const conflict = asConflict(c.status, c.result);
  if (opts.warehouseId) {
    if (c.type !== "sale.convert" || conflict?.kind !== "stock") throw new AppError("Solo una venta sin existencias se puede surtir desde otro almacén.");
    if (!(await db.warehouse.findFirst({ where: { id: opts.warehouseId, active: true }, select: { id: true } }))) throw new AppError("Almacén inválido.");
  }
  const warehouseId = opts.warehouseId;
  const result = await rerun(actor, c, (x) => (x.type === "sale.convert" && warehouseId ? { ...x, payload: { ...x.payload, warehouseId } } : x));
  await markApplied(actor, commandId, result, "sync.conflict_retried", { type: c.type, kind: conflict?.kind ?? null, ...(warehouseId && { warehouseId }) });
  await notify([c.userId], {
    kind: "sync.conflict", title: "Conflicto de sincronización resuelto",
    body: `${typeText(c.type)} se aplicó${warehouseId ? " surtiendo desde otro almacén" : ""}.`,
    href: appliedHref(c.type, result),
  });
  return { status: "APPLIED" as const, result };
}

const REJECT_TEXT: Record<string, string> = {
  stock: "sin existencia suficiente para surtirla",
  duplicate_rfc: "el RFC ya está registrado en otro cliente; búscalo y úsalo en lugar de crear uno nuevo",
  price: "conflicto de precios",
};

/** «Rechazar» un conflicto: se descarta (REJECTED), se audita y se avisa al vendedor. */
export async function rejectSyncConflict(actor: CurrentUser, commandId: string) {
  assertCan(actor, "users.manage");
  const c = await pendingConflict(commandId);
  const conflict = asConflict(c.status, c.result);
  const why = conflict ? REJECT_TEXT[conflict.kind] : undefined;
  const detail = conflict?.kind === "duplicate_rfc" ? ` (RFC ${conflict.rfc})` : "";
  await rejectClaimed(actor, commandId, `Rechazado por gerencia${why ? `: ${why}${detail}` : ""}.`, "sync.conflict_rejected",
    { type: c.type, kind: conflict?.kind ?? null });
  await notify([c.userId], {
    kind: "sync.conflict", title: "Operación rechazada por gerencia",
    body: `${typeText(c.type)} fue rechazada${why ? `: ${why}${detail}` : ""}.`,
  });
  return { status: "REJECTED" as const };
}
