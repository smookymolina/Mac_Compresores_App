import type { CommissionBasis, ProductLine } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { dec } from "@/lib/money";
import { calculateCommissions } from "./calc";

export async function listRuleSets() {
  return db.commissionRuleSet.findMany({ include: { rates: true }, orderBy: [{ name: "asc" }, { version: "desc" }] });
}

/** Crea una nueva versión (borrador). Las versiones nunca se editan después de activarse. */
export async function createRuleSetVersion(
  user: CurrentUser,
  input: { name: string; basis: CommissionBasis; notes?: string; rates: { line: ProductLine; rateMet: string; rateNotMet: string }[] },
) {
  const last = await db.commissionRuleSet.findFirst({ where: { name: input.name }, orderBy: { version: "desc" } });
  const rs = await db.commissionRuleSet.create({
    data: {
      name: input.name,
      version: (last?.version ?? 0) + 1,
      basis: input.basis,
      notes: input.notes || null,
      rates: { create: input.rates.map((r) => ({ line: r.line, rateMet: dec(r.rateMet), rateNotMet: dec(r.rateNotMet) })) },
    },
  });
  await audit({ userId: user.id, action: "commission.ruleset.create", entity: "CommissionRuleSet", entityId: rs.id,
    data: { version: rs.version } });
  return rs;
}

/** Activa una versión (requiere confirmación del criterio comercial); archiva la activa anterior. */
export async function activateRuleSet(user: CurrentUser, id: string) {
  const rs = await db.commissionRuleSet.findUnique({ where: { id }, include: { rates: true } });
  if (!rs) throw new AppError("Regla no encontrada.", "NOT_FOUND");
  if (rs.status !== "DRAFT") throw new AppError("Solo se activan reglas en borrador.", "CONFLICT");
  if (rs.basis === "COLLECTED") throw new AppError("La base 'cobranza' aún no está disponible.");
  if (rs.rates.length === 0) throw new AppError("La regla no tiene tasas.");
  await db.$transaction(async (tx) => {
    await tx.commissionRuleSet.updateMany({ where: { status: "ACTIVE" }, data: { status: "ARCHIVED" } });
    await tx.commissionRuleSet.update({
      where: { id },
      data: { status: "ACTIVE", activatedById: user.id, activatedAt: new Date() },
    });
    await tx.approval.create({ data: { entityType: "CommissionRuleSet", entityId: id, action: "activate", decidedById: user.id } });
    await audit({ userId: user.id, action: "commission.ruleset.activate", entity: "CommissionRuleSet", entityId: id }, tx);
  });
}

export async function listPeriods() {
  return db.commissionPeriod.findMany({ orderBy: { startDate: "desc" } });
}

export async function createPeriod(user: CurrentUser, input: { name: string; startDate: Date; endDate: Date }) {
  if (input.endDate < input.startDate) throw new AppError("La fecha final es anterior a la inicial.");
  const p = await db.commissionPeriod.create({ data: input });
  await audit({ userId: user.id, action: "commission.period.create", entity: "CommissionPeriod", entityId: p.id });
  return p;
}

export async function setTarget(user: CurrentUser, periodId: string, sellerId: string, amount: string) {
  const period = await db.commissionPeriod.findUnique({ where: { id: periodId } });
  if (!period || period.status !== "OPEN") throw new AppError("Periodo cerrado o inexistente.", "CONFLICT");
  await db.salesTarget.upsert({
    where: { periodId_sellerId: { periodId, sellerId } },
    create: { periodId, sellerId, amount: dec(amount) },
    update: { amount: dec(amount) },
  });
  await audit({ userId: user.id, action: "commission.target", entity: "SalesTarget", entityId: periodId, data: { sellerId, amount } });
}

export async function getPeriodDetail(user: CurrentUser, periodId: string) {
  const period = await db.commissionPeriod.findUnique({
    where: { id: periodId },
    include: { targets: { include: { seller: { select: { name: true } } } } },
  });
  if (!period) throw new AppError("Periodo no encontrado.", "NOT_FOUND");
  const entries = await db.commissionEntry.findMany({
    where: { periodId, ...(can(user, "commissions.read_all") ? {} : { sellerId: user.id }) },
    include: { seller: { select: { name: true } }, ruleSet: { select: { name: true, version: true, basis: true } } },
    orderBy: [{ seller: { name: "asc" } }, { line: "asc" }],
  });
  return { period, entries };
}

/** Recalcula (solo si nada está aprobado) usando la regla ACTIVA; guarda la versión usada en cada partida. */
export async function calculatePeriod(user: CurrentUser, periodId: string) {
  const period = await db.commissionPeriod.findUnique({ where: { id: periodId }, include: { targets: true } });
  if (!period) throw new AppError("Periodo no encontrado.", "NOT_FOUND");
  if (period.status !== "OPEN") throw new AppError("El periodo está cerrado.", "CONFLICT");
  const ruleSet = await db.commissionRuleSet.findFirst({ where: { status: "ACTIVE" }, include: { rates: true } });
  if (!ruleSet) {
    throw new AppError("No hay regla de comisión activa. Confirma el criterio comercial y activa una versión.", "CONFLICT");
  }

  // Fechas del periodo en hora de Ciudad de México (UTC-6, sin horario de verano desde 2022).
  const MX_OFFSET_MS = 6 * 3600_000;
  const start = new Date(period.startDate.getTime() + MX_OFFSET_MS);
  const end = new Date(period.endDate.getTime() + 24 * 3600_000 + MX_OFFSET_MS);
  const lines = await db.saleItem.findMany({
    where: { sale: { status: "CONFIRMED", confirmedAt: { gte: start, lt: end } } },
    select: { line: true, quantity: true, subtotal: true, discount: true, unitCost: true, sale: { select: { sellerId: true } } },
  });
  const calculated = calculateCommissions(
    ruleSet.basis,
    lines.map((l) => ({ ...l, sellerId: l.sale.sellerId })),
    ruleSet.rates,
    new Map(period.targets.map((t) => [t.sellerId, t.amount])),
  );

  await db.$transaction(async (tx) => {
    const locked = await tx.commissionEntry.count({ where: { periodId, status: { not: "CALCULATED" } } });
    if (locked > 0) throw new AppError("Hay comisiones aprobadas o pagadas; no se puede recalcular.", "CONFLICT");
    await tx.commissionEntry.deleteMany({ where: { periodId } });
    await tx.commissionEntry.createMany({ data: calculated.map((c) => ({ ...c, periodId, ruleSetId: ruleSet.id })) });
    await audit({ userId: user.id, action: "commission.calculate", entity: "CommissionPeriod", entityId: periodId,
      data: { ruleSet: ruleSet.id, version: ruleSet.version, entries: calculated.length } }, tx);
  });
  return calculated.length;
}

export async function approveSeller(user: CurrentUser, periodId: string, sellerId: string) {
  await db.$transaction(async (tx) => {
    const res = await tx.commissionEntry.updateMany({
      where: { periodId, sellerId, status: "CALCULATED" },
      data: { status: "APPROVED", approvedById: user.id, approvedAt: new Date() },
    });
    if (res.count === 0) throw new AppError("No hay comisiones por aprobar.", "CONFLICT");
    await tx.approval.create({ data: { entityType: "CommissionPeriod", entityId: periodId, action: `approve:${sellerId}`, decidedById: user.id } });
    await audit({ userId: user.id, action: "commission.approve", entity: "CommissionPeriod", entityId: periodId, data: { sellerId } }, tx);
  });
}

export async function markSellerPaid(user: CurrentUser, periodId: string, sellerId: string) {
  await db.$transaction(async (tx) => {
    const res = await tx.commissionEntry.updateMany({
      where: { periodId, sellerId, status: "APPROVED" },
      data: { status: "PAID", paidAt: new Date() },
    });
    if (res.count === 0) throw new AppError("No hay comisiones aprobadas por pagar.", "CONFLICT");
    await audit({ userId: user.id, action: "commission.pay", entity: "CommissionPeriod", entityId: periodId, data: { sellerId } }, tx);
  });
}

export async function closePeriod(user: CurrentUser, periodId: string) {
  await db.$transaction(async (tx) => {
    const pending = await tx.commissionEntry.count({ where: { periodId, status: "CALCULATED" } });
    if (pending > 0) throw new AppError("Aprueba todas las comisiones antes de cerrar.", "CONFLICT");
    const res = await tx.commissionPeriod.updateMany({ where: { id: periodId, status: "OPEN" }, data: { status: "CLOSED" } });
    if (res.count === 0) throw new AppError("El periodo ya está cerrado o no existe.", "CONFLICT");
    await audit({ userId: user.id, action: "commission.period.close", entity: "CommissionPeriod", entityId: periodId }, tx);
  });
}
