import "server-only";
import { PartnerActivityType, type Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/auth/session";
import { pageArgs, paged } from "@/lib/pagination";
import { getPartnerSettings } from "./pricing";

/** Campos visibles en el admin: nunca el hash de contraseña, el secreto TOTP ni los códigos de respaldo. */
const partnerAdminSelect = {
  id: true, email: true, name: true, company: true, discountPct: true, dailyQuota: true, status: true,
  blockedReason: true, blockedAt: true, lastSeenAt: true, failedLogins: true, totpEnabledAt: true, passwordSetAt: true, createdAt: true,
} satisfies Prisma.PartnerSelect;

export async function listPartners(opts: { search?: string; page?: number; status?: "ACTIVE" | "BLOCKED" } = {}) {
  await requirePermission("partners.manage");
  const q = opts.search?.trim();
  const where: Prisma.PartnerWhereInput = {
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { company: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } : {}),
    ...(opts.status ? { status: opts.status } : {}),
  };
  const { page, skip, take } = pageArgs(opts.page);
  const [rows, total] = await Promise.all([
    db.partner.findMany({ where, select: partnerAdminSelect, orderBy: [{ status: "asc" }, { company: "asc" }], skip, take }),
    db.partner.count({ where }),
  ]);
  return paged(rows, total, page);
}

export async function getPartner(id: string) {
  await requirePermission("partners.manage");
  const [partner, settings] = await Promise.all([
    db.partner.findUnique({
      where: { id },
      select: { ...partnerAdminSelect, sessions: { select: { ip: true, userAgent: true, lastActivityAt: true, createdAt: true, expiresAt: true } } },
    }),
    getPartnerSettings(),
  ]);
  return partner ? { partner, settings } : null;
}

export interface ActivityFilter {
  partnerId?: string;
  type?: string;
  from?: Date | string;
  to?: Date | string;
  page?: number;
}

/** Historial paginado de actividad con filtros opcionales (el `to` incluye todo ese día). */
export async function listPartnerActivity(f: ActivityFilter = {}) {
  await requirePermission("partners.manage");
  const where: Prisma.PartnerActivityWhereInput = {};
  if (f.partnerId) where.partnerId = f.partnerId;
  if (f.type && f.type in PartnerActivityType) where.type = f.type as PartnerActivityType;
  const from = f.from ? new Date(f.from) : null;
  const to = f.to ? new Date(f.to) : null;
  if (to && typeof f.to === "string" && f.to.length <= 10) to.setUTCHours(23, 59, 59, 999);
  if ((from && !isNaN(+from)) || (to && !isNaN(+to))) {
    where.createdAt = { ...(from && !isNaN(+from) ? { gte: from } : {}), ...(to && !isNaN(+to) ? { lte: to } : {}) };
  }
  const { page, skip, take } = pageArgs(f.page);
  const [rows, total] = await Promise.all([
    db.partnerActivity.findMany({
      where, orderBy: { createdAt: "desc" }, skip, take,
      select: { id: true, type: true, meta: true, ip: true, userAgent: true, createdAt: true, partnerId: true, partner: { select: { name: true, company: true } } },
    }),
    db.partnerActivity.count({ where }),
  ]);
  return paged(rows, total, page);
}

/** Socios para el selector del historial (sin datos sensibles). */
export async function listPartnerOptions() {
  await requirePermission("partners.manage");
  return db.partner.findMany({ select: { id: true, name: true, company: true }, orderBy: [{ company: "asc" }, { name: "asc" }] });
}

/** Cuántos socios usan el descuento global (sin descuento propio) y cuántos hay en total. */
export async function getPartnerCounts() {
  await requirePermission("partners.manage");
  const [total, onGlobal] = await Promise.all([db.partner.count(), db.partner.count({ where: { discountPct: null } })]);
  return { total, onGlobal };
}
