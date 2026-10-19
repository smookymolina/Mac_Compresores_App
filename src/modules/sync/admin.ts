import "server-only";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";
import { notify } from "@/modules/notifications/service";
import { loadCurrentUser } from "./device";
import { applyCommand } from "./push";
import { syncCommandSchema, type PriceConflictResult } from "./protocol";

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
    select: { id: true, type: true, status: true, error: true, result: true, capturedAt: true, receivedAt: true, userId: true, device: { select: { name: true } } },
    orderBy: { receivedAt: "desc" },
    take,
  });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.userId))] } }, select: { id: true, name: true } });
  const names = new Map(users.map((u) => [u.id, u.name]));
  return items.map(({ result, ...i }) => ({ ...i, priceConflict: asPriceConflict(i.status, result), userName: names.get(i.userId) ?? null }));
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

const asPriceConflict = (status: string, r: unknown): PriceConflictResult | null =>
  status === "CONFLICT" && typeof r === "object" && r !== null && (r as { kind?: unknown }).kind === "price" ? (r as PriceConflictResult) : null;

export type PriceResolution = "server" | "client" | "reject";

const RESOLUTION_TEXT: Record<PriceResolution, string> = {
  server: "se aplicó con los precios vigentes",
  client: "se aplicó con los precios que mostró tu teléfono",
  reject: "fue rechazada por gerencia",
};

/**
 * Resuelve un conflicto de precios (§5.3). `server` vuelve a aplicar el comando con los precios vigentes,
 * `client` con los del teléfono (requiere `quotes.override_price`), `reject` lo descarta. El comando se aplica
 * como el usuario del dispositivo (sus scopes). Guarda de estado: se reclama el comando (CONFLICT sin resolver)
 * antes de aplicarlo; si el servicio falla, se libera para reintentar.
 */
export async function resolvePriceConflict(actor: CurrentUser, commandId: string, mode: PriceResolution) {
  assertCan(actor, "users.manage");
  if (mode === "client") assertCan(actor, "quotes.override_price");
  const c = await db.syncCommand.findUnique({ where: { id: commandId }, include: { device: true } });
  if (!c) throw new AppError("Incidencia no encontrada.", "NOT_FOUND");
  if (c.resolvedAt || !asPriceConflict(c.status, c.result)) throw new AppError("La incidencia no es un conflicto de precios pendiente.", "CONFLICT");

  const claim = (tx: Prisma.TransactionClient) => tx.syncCommand.updateMany({
    where: { id: commandId, status: "CONFLICT", resolvedAt: null }, data: { resolvedAt: new Date(), resolvedById: actor.id },
  });
  let result: Prisma.InputJsonObject | undefined;
  if (mode === "reject") {
    await db.$transaction(async (tx) => {
      if ((await claim(tx)).count === 0) throw new AppError("La incidencia ya fue resuelta.", "CONFLICT");
      await tx.syncCommand.update({ where: { id: commandId }, data: { status: "REJECTED", error: "Rechazado por gerencia (conflicto de precios)." } });
      await audit({ userId: actor.id, action: "sync.price_conflict_resolved", entity: "SyncCommand", entityId: commandId, data: { mode } }, tx);
    });
  } else {
    const parsed = syncCommandSchema.safeParse(c.payload);
    if (!parsed.success || (parsed.data.type !== "quote.create" && parsed.data.type !== "quote.update"))
      throw new AppError("El comando guardado no se puede volver a aplicar.");
    const user = await loadCurrentUser(c.userId);
    if (!user) throw new AppError("El vendedor ya no tiene acceso a la app móvil.", "CONFLICT");
    if ((await db.$transaction(claim)).count === 0) throw new AppError("La incidencia ya fue resuelta.", "CONFLICT");
    try {
      result = await applyCommand(user, c.device, parsed.data, mode);
    } catch (e) {
      await db.syncCommand.updateMany({ where: { id: commandId, status: "CONFLICT", resolvedById: actor.id }, data: { resolvedAt: null, resolvedById: null } });
      throw e;
    }
    await db.$transaction(async (tx) => {
      await tx.syncCommand.update({ where: { id: commandId }, data: { status: "APPLIED", result, error: null } });
      await audit({ userId: actor.id, action: "sync.price_conflict_resolved", entity: "SyncCommand", entityId: commandId,
        data: { mode, quoteId: result?.id ?? null } }, tx);
    });
  }
  const quoteId = typeof result?.id === "string" ? result.id : null;
  await notify([c.userId], {
    kind: "sync.price_conflict", title: "Conflicto de precios resuelto",
    body: `Tu cotización capturada sin conexión ${RESOLUTION_TEXT[mode]}.`,
    href: quoteId ? `/cotizaciones/${quoteId}` : undefined,
  });
  return { status: mode === "reject" ? "REJECTED" : "APPLIED", result };
}
