import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => false,
  sendMail: async () => {},
  companyReplyTo: () => "ventas@test",
}));
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type Permission, type RoleCode } from "@/lib/auth/permissions";
import { changeQuoteStatus, createQuote, getQuote, reviewLostReason } from "@/modules/quotes/service";
import { getDashboard } from "@/modules/dashboard/service";

const tag = `v1321l-${Date.now()}`;
type U = { id: string; name: string; email: string; role: RoleCode; roleName: string; permissions: Set<Permission> };
let admin: U, seller: U, customerId: string, productId: string;

async function mk(code: RoleCode, n: string): Promise<U> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  for (const p of ROLE_PERMISSIONS[code]) {
    const perm = await db.permission.upsert({ where: { code: p }, create: { code: p }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
  }
  const u = await db.user.create({ data: { email: `${tag}-${n}@t`, name: `${n} ${tag}`, passwordHash: "x", roleId: role.id } });
  return { id: u.id, name: u.name, email: u.email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}
const newQuote = (u: U) => createQuote(u, { customerId, sellerId: u.id, validUntil: new Date(Date.now() + 7 * 864e5), items: [{ productId, quantity: "1", discountPct: "0" }] });
const lastAudit = (id: string, action: string) => db.auditLog.findFirst({ where: { entityId: id, action }, orderBy: { createdAt: "desc" } });

beforeAll(async () => {
  admin = await mk("ADMIN", "admin");
  seller = await mk("VENTAS", "vend");
  customerId = (await db.customer.create({ data: { legalName: `${tag} Cliente`, ownerId: seller.id } })).id;
  productId = (await db.product.create({ data: { sku: `${tag}-P`, description: "Filtro", line: "VALVULAS_OTROS", price: 1000 } })).id;
});

afterAll(async () => {
  await db.quote.deleteMany({ where: { customer: { legalName: { startsWith: tag } } } });
  await db.customer.deleteMany({ where: { legalName: { startsWith: tag } } });
  await db.product.deleteMany({ where: { sku: { startsWith: tag } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

describe("motivo de pérdida obligatorio (servidor)", () => {
  it("rechazar o cancelar sin motivo falla y no cambia el estado", async () => {
    const q = await newQuote(seller);
    await expect(changeQuoteStatus(seller, q.id, "CANCELLED")).rejects.toThrow(/motivo de pérdida/);
    await changeQuoteStatus(seller, q.id, "SENT");
    await expect(changeQuoteStatus(seller, q.id, "REJECTED", { reason: "" })).rejects.toThrow(/motivo de pérdida/);
    expect((await getQuote(seller, q.id)).status).toBe("SENT");
  });

  it("no acepta ABANDONED manual ni «Otro» sin nota", async () => {
    const q = await newQuote(seller);
    await expect(changeQuoteStatus(seller, q.id, "CANCELLED", { reason: "ABANDONED" })).rejects.toThrow(/motivo de pérdida/);
    await expect(changeQuoteStatus(seller, q.id, "CANCELLED", { reason: "OTHER", note: "  " })).rejects.toThrow(/Otro/);
  });

  it("con motivo guarda el motivo, la nota y la auditoría", async () => {
    const q = await newQuote(seller);
    await changeQuoteStatus(seller, q.id, "SENT");
    await changeQuoteStatus(seller, q.id, "REJECTED", { reason: "PRICE", note: "Competencia 10% abajo" });
    const after = await getQuote(seller, q.id);
    expect(after).toMatchObject({ status: "REJECTED", lostReason: "PRICE", lostNote: "Competencia 10% abajo", lostReviewedAt: null });
    expect((await lastAudit(q.id, "quote.status"))?.data).toMatchObject({ from: "SENT", to: "REJECTED", lostReason: "PRICE" });
  });

  it("otros estados no piden motivo", async () => {
    const q = await newQuote(seller);
    await changeQuoteStatus(seller, q.id, "SENT");
    expect((await getQuote(seller, q.id)).lostReason).toBeNull();
  });
});

describe("validación del administrador", () => {
  it("el vendedor no puede validar; el administrador valida y corrige", async () => {
    const q = await newQuote(seller);
    await changeQuoteStatus(seller, q.id, "CANCELLED", { reason: "NO_RESPONSE" });
    await expect(reviewLostReason(seller, q.id, { reason: "PRICE" })).rejects.toThrow(/administrador/);
    await reviewLostReason(admin, q.id, { reason: "COMPETITOR", note: "Compró a otro proveedor" });
    const after = await getQuote(admin, q.id);
    expect(after).toMatchObject({ lostReason: "COMPETITOR", lostNote: "Compró a otro proveedor", lostReviewedById: admin.id });
    expect(after.lostReviewedAt).toBeInstanceOf(Date);
    expect((await lastAudit(q.id, "quote.lost_review"))?.data).toMatchObject({ before: { reason: "NO_RESPONSE" }, after: { reason: "COMPETITOR" } });
  });

  it("solo aplica a cotizaciones rechazadas o canceladas", async () => {
    const q = await newQuote(seller);
    await expect(reviewLostReason(admin, q.id, { reason: "PRICE" })).rejects.toThrow(/rechazadas o canceladas/);
  });
});

describe("tablero", () => {
  it("cotizaciones en curso excluye borradores; los borradores van aparte", async () => {
    const solo = await mk("VENTAS", "tablero");
    const cust = (await db.customer.create({ data: { legalName: `${tag} Cliente tablero`, ownerId: solo.id } })).id;
    const mine = () => createQuote(solo, { customerId: cust, sellerId: solo.id, validUntil: new Date(Date.now() + 7 * 864e5), items: [{ productId, quantity: "1", discountPct: "0" }] });
    const d1 = await mine();
    const s1 = await mine();
    await changeQuoteStatus(solo, s1.id, "SENT");
    const a1 = await mine();
    await changeQuoteStatus(solo, a1.id, "SENT");
    await changeQuoteStatus(solo, a1.id, "ACCEPTED");
    const d = await getDashboard(solo);
    expect(d.openQuotes?.count).toBe(2);
    expect(d.draftQuotes?.count).toBe(1);
    expect(d1.status).toBe("DRAFT");
  });
});
