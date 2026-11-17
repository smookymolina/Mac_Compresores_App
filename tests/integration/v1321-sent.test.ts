import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; subject: string; html: string }[]);
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => true,
  sendMail: async (m: { to: string; subject: string; html: string }) => { sent.push(m); },
  companyReplyTo: () => "ventas@test",
}));
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type Permission, type RoleCode } from "@/lib/auth/permissions";
import { confirmQuoteSent, createQuote, getQuote } from "@/modules/quotes/service";

const tag = `v1321s-${Date.now()}`;
type U = { id: string; name: string; email: string; role: RoleCode; roleName: string; permissions: Set<Permission> };
let seller: U, seller2: U, customerId: string, productId: string;

async function mk(code: RoleCode, n: string): Promise<U> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  for (const p of ROLE_PERMISSIONS[code]) {
    const perm = await db.permission.upsert({ where: { code: p }, create: { code: p }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
  }
  const u = await db.user.create({ data: { email: `${tag}-${n}@t`, name: `${n} ${tag}`, passwordHash: "x", roleId: role.id } });
  return { id: u.id, name: u.name, email: u.email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}
const base = () => ({ customerId, validUntil: new Date(Date.now() + 7 * 864e5) });

beforeAll(async () => {
  seller = await mk("VENTAS", "vend1");
  seller2 = await mk("VENTAS", "vend2");
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

const items = () => [{ productId, quantity: "1", discountPct: "0" }];

describe("confirmar envío tras descargar el PDF", () => {
  it("DRAFT pasa a SENT con auditoría y la segunda llamada no hace nada", async () => {
    const q = await createQuote(seller, { ...base(), items: items() });
    expect(await confirmQuoteSent(seller, q.id)).toBe(true);
    expect((await getQuote(seller, q.id)).status).toBe("SENT");
    const logs = await db.auditLog.findMany({ where: { entity: "Quote", entityId: q.id } });
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["quote.status", "quote.sent_confirmed"]));
    expect(logs.find((l) => l.action === "quote.sent_confirmed")?.data).toMatchObject({ via: "pdf" });
    expect(await confirmQuoteSent(seller, q.id)).toBe(false);
    expect(await db.auditLog.count({ where: { entityId: q.id, action: "quote.sent_confirmed" } })).toBe(1);
  });

  it("un vendedor ajeno no puede", async () => {
    const q = await createQuote(seller, { ...base(), items: items() });
    await expect(confirmQuoteSent(seller2, q.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("con descuento pendiente falla", async () => {
    const q = await createQuote(seller, { ...base(), discountNote: "x", items: [{ productId, quantity: "1", discountPct: "0.1" }] });
    await expect(confirmQuoteSent(seller, q.id)).rejects.toThrow(/autorización/);
    expect((await getQuote(seller, q.id)).status).toBe("DRAFT");
  });
});
