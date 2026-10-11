import type { CommissionBasis, Prisma, ProductLine } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { dec, round2, type Dec } from "@/lib/money";
import { collectedAt, commissionForSale, metTarget } from "./calc";

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
      basis: "MARGIN", // La comisión siempre se calcula sobre la utilidad neta después de gastos.
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

/** Periodos mensuales: del día 1 al último día del mismo mes, sin traslapes. */
export async function createPeriod(user: CurrentUser, input: { name: string; startDate: Date; endDate: Date }) {
  const s = input.startDate, e = input.endDate;
  const lastDay = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
  if (s.getUTCDate() !== 1 || e.getTime() !== lastDay.getTime()) {
    throw new AppError("El periodo de comisiones es mensual: del día 1 al último día del mes.");
  }
  const overlap = await db.commissionPeriod.count({ where: { startDate: { lte: e }, endDate: { gte: s } } });
  if (overlap > 0) throw new AppError("Ya existe un periodo para ese mes.", "CONFLICT");
  const p = await db.commissionPeriod.create({ data: input });
  await audit({ userId: user.id, action: "commission.period.create", entity: "CommissionPeriod", entityId: p.id });
  return p;
}

// Fechas del periodo en hora de Ciudad de México (UTC-6, sin horario de verano desde 2022).
const MX_OFFSET_MS = 6 * 3600_000;
type PeriodDates = { startDate: Date; endDate: Date };
const rangeOf = (p: PeriodDates) => ({
  gte: new Date(p.startDate.getTime() + MX_OFFSET_MS),
  lt: new Date(p.endDate.getTime() + 24 * 3600_000 + MX_OFFSET_MS),
});

/** Venta total (O.C. confirmadas, neto sin IVA) de un vendedor en el mes del periodo. */
async function monthSales(sellerId: string, p: PeriodDates) {
  const agg = await db.sale.aggregate({
    where: { sellerId, status: "CONFIRMED", confirmedAt: rangeOf(p) },
    _sum: { subtotal: true, discountTotal: true },
  });
  return dec(agg._sum.subtotal ?? 0).sub(dec(agg._sum.discountTotal ?? 0));
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
  const all = can(user, "commissions.read_all");
  const entries = await db.commissionEntry.findMany({
    where: { periodId, ...(all ? {} : { sellerId: user.id }) },
    include: {
      seller: { select: { name: true } }, ruleSet: { select: { name: true, version: true, basis: true } },
      sale: { select: { id: true, folio: true, confirmedAt: true } },
    },
    orderBy: [{ seller: { name: "asc" } }, { sale: { folio: "asc" } }, { line: "asc" }],
  });

  // Resumen de meta del mes por vendedor: venta total (O.C.) vs meta y O.C. del mes aún sin cobrar.
  const monthly = await db.sale.findMany({
    where: { status: "CONFIRMED", confirmedAt: rangeOf(period), ...(all ? {} : { sellerId: user.id }) },
    select: { id: true, folio: true, sellerId: true, subtotal: true, discountTotal: true, total: true,
      seller: { select: { name: true } }, payments: { where: { voidedAt: null }, select: { amount: true, paidAt: true } } },
  });
  const bySeller = new Map<string, { name: string; total: Dec; pending: number[] }>();
  for (const t of period.targets) if (all || t.sellerId === user.id) bySeller.set(t.sellerId, { name: t.seller.name, total: dec(0), pending: [] });
  for (const s of monthly) {
    const row = bySeller.get(s.sellerId) ?? { name: s.seller.name, total: dec(0), pending: [] };
    row.total = row.total.add(s.subtotal.sub(s.discountTotal));
    const c = collectedAt(s.total, s.payments);
    if (!c || c > period.endDate) row.pending.push(s.folio);
    bySeller.set(s.sellerId, row);
  }
  const targets = new Map(period.targets.map((t) => [t.sellerId, t.amount]));
  const summary = [...bySeller].map(([sellerId, r]) => ({
    sellerId, name: r.name, monthTotal: r.total, target: targets.get(sellerId) ?? dec(0),
    met: metTarget(r.total, targets.get(sellerId)), pendingFolios: r.pending,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { period, entries, summary };
}

/**
 * Recalcula (solo si nada está aprobado) usando la regla ACTIVA.
 * Comisionan las ventas cobradas al 100% dentro del periodo, con el % del mes de su O.C.
 */
export async function calculatePeriod(user: CurrentUser | null, periodId: string) {
  const period = await db.commissionPeriod.findUnique({ where: { id: periodId } });
  if (!period) throw new AppError("Periodo no encontrado.", "NOT_FOUND");
  if (period.status !== "OPEN") throw new AppError("El periodo está cerrado.", "CONFLICT");
  const ruleSet = await db.commissionRuleSet.findFirst({ where: { status: "ACTIVE" }, include: { rates: true } });
  if (!ruleSet) {
    throw new AppError("No hay regla de comisión activa. Confirma el criterio comercial y activa una versión.", "CONFLICT");
  }

  // Ventas con algún pago dentro del periodo; se conservan las que quedaron cobradas al 100% en él.
  const candidates = await db.sale.findMany({
    where: {
      status: "CONFIRMED",
      confirmedAt: { lt: rangeOf(period).lt },
      payments: { some: { voidedAt: null, paidAt: { gte: period.startDate, lte: period.endDate } } },
      // Una venta ya comisionada (aprobada/pagada) en otro periodo no se vuelve a pagar.
      commissions: { none: { periodId: { not: periodId }, status: { in: ["APPROVED", "PAID"] } } },
    },
    include: {
      items: { select: { line: true, quantity: true, subtotal: true, discount: true, unitCost: true } },
      payments: { where: { voidedAt: null }, select: { amount: true, paidAt: true } },
    },
  });

  const periods = await db.commissionPeriod.findMany({ include: { targets: true } });
  const originOf = (d: Date) => periods.find((p) => { const r = rangeOf(p); return d >= r.gte && d < r.lt; });
  const metCache = new Map<string, { met: boolean; total: Dec; target: Dec }>();
  async function origin(sellerId: string, confirmedAt: Date) {
    const p = originOf(confirmedAt);
    if (!p) return { met: false, total: dec(0), target: dec(0) }; // sin periodo/meta en el mes de la O.C.
    const key = `${p.id}:${sellerId}`;
    if (!metCache.has(key)) {
      const total = await monthSales(sellerId, p);
      const target = p.targets.find((t) => t.sellerId === sellerId)?.amount ?? dec(0);
      metCache.set(key, { met: metTarget(total, target), total, target });
    }
    return metCache.get(key)!;
  }

  const data: Prisma.CommissionEntryCreateManyInput[] = [];
  for (const sale of candidates) {
    const paidOn = collectedAt(sale.total, sale.payments);
    if (!paidOn || paidOn < period.startDate || paidOn > period.endDate) continue;
    const o = await origin(sale.sellerId, sale.confirmedAt);
    for (const c of commissionForSale(sale.items, sale.expenses, ruleSet.rates, o.met)) {
      data.push({
        periodId, sellerId: sale.sellerId, ruleSetId: ruleSet.id, saleId: sale.id, collectedAt: paidOn,
        sellerTotal: round2(o.total), targetAmount: o.target, metTarget: o.met, ...c,
      });
    }
  }

  await db.$transaction(async (tx) => {
    const locked = await tx.commissionEntry.count({ where: { periodId, status: { not: "CALCULATED" } } });
    if (locked > 0) throw new AppError("Hay comisiones aprobadas o pagadas; no se puede recalcular.", "CONFLICT");
    await tx.commissionEntry.deleteMany({ where: { periodId } });
    await tx.commissionEntry.createMany({ data });
    await audit({ userId: user?.id ?? null, action: "commission.calculate", entity: "CommissionPeriod", entityId: periodId,
      data: { ruleSet: ruleSet.id, version: ruleSet.version, entries: data.length } }, tx);
  });
  return data.length;
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
