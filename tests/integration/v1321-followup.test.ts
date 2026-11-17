import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => true,
  sendMail: async (m: { to: string; subject: string; html: string }) => { sent.push(m); },
  companyReplyTo: () => "ventas@test",
}));
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type Permission, type RoleCode } from "@/lib/auth/permissions";
import { createQuote } from "@/modules/quotes/service";
import { runDailyJob } from "@/modules/jobs/daily";

const tag = `v1321-${Date.now()}`;
type U = { id: string; name: string; email: string; role: RoleCode; roleName: string; permissions: Set<Permission> };
let admin1: U, admin2: U, seller: U, seller2: U, seller3: U, customerId: string, productId: string, bigProductId: string;

async function mk(code: RoleCode, n: string): Promise<U> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  for (const p of ROLE_PERMISSIONS[code]) {
    const perm = await db.permission.upsert({ where: { code: p }, create: { code: p }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
  }
  const u = await db.user.create({ data: { email: `${tag}-${n}@t`, name: `${n} ${tag}`, passwordHash: "x", roleId: role.id } });
  return { id: u.id, name: u.name, email: u.email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}
const base = () => ({ customerId, validUntil: new Date(Date.now() + 30 * 864e5) });
const DAY = 864e5;
/** Cotización de `who` con estado y antigüedad (updatedAt es @updatedAt: se fuerza con SQL). */
async function quote(who: U, status: "DRAFT" | "SENT" | "ACCEPTED", ageDays: number, now: Date, big = false) {
  const q = await createQuote(admin1, { ...base(), sellerId: who.id, items: [{ productId: big ? bigProductId : productId, quantity: "1", discountPct: "0" }] });
  const at = new Date(now.getTime() - ageDays * DAY);
  await db.$executeRaw`UPDATE "Quote" SET status = ${status}::"QuoteStatus", "updatedAt" = ${at} WHERE id = ${q.id}::uuid`;
  return q;
}
const notes = (u: U, kind: string, id?: string) => db.notification.findMany({ where: { userId: u.id, kind, ...(id ? { href: `/cotizaciones/${id}` } : {}) } });
const get = (id: string) => db.quote.findUniqueOrThrow({ where: { id } });
const nowAt = (k: number) => new Date(Date.now() + k * 400 * DAY); // día distinto por prueba (resúmenes por día)

beforeAll(async () => {
  admin1 = await mk("ADMIN", "admin1");
  admin2 = await mk("ADMIN", "admin2");
  seller = await mk("VENTAS", "vend1");
  seller2 = await mk("VENTAS", "vend2");
  seller3 = await mk("VENTAS", "vend3");
  customerId = (await db.customer.create({ data: { legalName: `${tag} Cliente`, ownerId: seller.id } })).id;
  productId = (await db.product.create({ data: { sku: `${tag}-P`, description: "Filtro", line: "VALVULAS_OTROS", price: 1000 } })).id;
  bigProductId = (await db.product.create({ data: { sku: `${tag}-B`, description: "Compresor", line: "VALVULAS_OTROS", price: 600000 } })).id;
});

afterAll(async () => {
  await db.quote.deleteMany({ where: { customer: { legalName: { startsWith: tag } } } });
  await db.customer.deleteMany({ where: { legalName: { startsWith: tag } } });
  await db.product.deleteMany({ where: { sku: { startsWith: tag } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

describe("cancelación automática de borradores", () => {
  it("a los 10 días cancela (ABANDONED + auditoría auto) y a los 9 no", async () => {
    const now = nowAt(1);
    const old = await quote(seller, "DRAFT", 10, now);
    const young = await quote(seller, "DRAFT", 9, now);
    await runDailyJob(now);
    const a = await get(old.id);
    expect(a.status).toBe("CANCELLED");
    expect(a.lostReason).toBe("ABANDONED");
    expect(a.lostNote).toMatch(/10 días/);
    expect((await get(young.id)).status).toBe("DRAFT");
    const log = await db.auditLog.findFirst({ where: { entityId: old.id, action: "quote.status" } });
    expect(log?.userId).toBeNull();
    expect(log?.data).toMatchObject({ from: "DRAFT", to: "CANCELLED", auto: true, lostReason: "ABANDONED" });
    expect(await notes(seller, "quote.abandoned", old.id)).toHaveLength(1);
    expect(await notes(seller, "quote.abandoned", young.id)).toHaveLength(0);
  });
});

describe("avisos de seguimiento", () => {
  it("borrador: vendedor a los 2 días; administradores a los 5", async () => {
    const now = nowAt(2);
    const d2 = await quote(seller, "DRAFT", 2, now);
    const d1 = await quote(seller, "DRAFT", 1, now);
    const d5 = await quote(seller2, "DRAFT", 5, now);
    await runDailyJob(now);
    expect(await notes(seller, "followup.draft", d2.id)).toHaveLength(1);
    expect(await notes(admin1, "followup.draft", d2.id)).toHaveLength(0);
    expect(await notes(seller, "followup.draft", d1.id)).toHaveLength(0);
    expect(await notes(seller2, "followup.draft", d5.id)).toHaveLength(1);
    for (const a of [admin1, admin2]) expect(await notes(a, "followup.draft", d5.id)).toHaveLength(1);
    expect(sent.some((m) => m.to === admin1.email && m.subject.includes(`C-${d5.folio} lleva 5 días`))).toBe(true);
    // Sin duplicados al repetir el job el mismo día.
    await runDailyJob(now);
    expect(await notes(admin1, "followup.draft", d5.id)).toHaveLength(1);
  });

  it("borrador por encima de $500 000 escala a administradores desde el día 2", async () => {
    const now = nowAt(3);
    const big = await quote(seller, "DRAFT", 2, now, true);
    await runDailyJob(now);
    expect(await notes(admin1, "followup.draft", big.id)).toHaveLength(1);
  });

  it("aceptada sin venta: vendedor a los 2 días, administradores a los 5", async () => {
    const now = nowAt(4);
    const a2 = await quote(seller, "ACCEPTED", 2, now);
    const a5 = await quote(seller2, "ACCEPTED", 5, now);
    await runDailyJob(now);
    expect(await notes(seller, "followup.accepted", a2.id)).toHaveLength(1);
    expect(await notes(admin1, "followup.accepted", a2.id)).toHaveLength(0);
    expect(await notes(seller2, "followup.accepted", a5.id)).toHaveLength(1);
    expect(await notes(admin2, "followup.accepted", a5.id)).toHaveLength(1);
  });
});

describe("resumen diario", () => {
  it("un solo correo y aviso por vendedor; administradores reciben uno global", async () => {
    const now = nowAt(5);
    const q1 = await quote(seller3, "DRAFT", 1, now);
    const q2 = await quote(seller3, "ACCEPTED", 1, now);
    const q3 = await quote(seller3, "SENT", 0, now);
    await db.$executeRaw`UPDATE "Quote" SET "validUntil" = ${new Date(now.getTime() + DAY)} WHERE id = ${q3.id}::uuid`;
    await runDailyJob(now);
    await runDailyJob(now);
    const mine = sent.filter((m) => m.to === seller3.email && m.subject.startsWith("Seguimiento:"));
    expect(mine).toHaveLength(1);
    for (const q of [q1, q2, q3]) expect(mine[0].html).toContain(`C-${q.folio}`);
    expect(await notes(seller3, "followup.summary")).toHaveLength(1);
    const global = sent.filter((m) => m.to === admin1.email && m.subject.startsWith("Seguimiento:") && m.html.includes(`C-${q1.folio}`));
    expect(global).toHaveLength(1);
    expect(global[0].html).toContain(seller3.name);
  });
});
