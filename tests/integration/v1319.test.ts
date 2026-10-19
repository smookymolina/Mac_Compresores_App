import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import { changeQuoteStatus, createQuote, decideDiscount, getQuote, updateQuote } from "@/modules/quotes/service";

const tag = `v1319-${Date.now()}`;
type U = { id: string; name: string; email: string; role: RoleCode; roleName: string; permissions: Set<string> };
let admin1: U, admin2: U, seller: U, seller2: U, customerId: string, productId: string;

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
const notes = (u: U, kind: string) => db.notification.findMany({ where: { userId: u.id, kind } });

beforeAll(async () => {
  admin1 = await mk("ADMIN", "admin1");
  admin2 = await mk("ADMIN", "admin2");
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

describe("asignar vendedor", () => {
  it("un administrador asigna la cotización a otro vendedor y este recibe aviso", async () => {
    const q = await createQuote(admin1, { ...base(), sellerId: seller.id, items: [{ productId, quantity: "1", discountPct: "0" }] });
    expect(q.sellerId).toBe(seller.id);
    expect(await notes(seller, "quote.assigned")).toHaveLength(1);
    await updateQuote(admin1, q.id, { ...base(), sellerId: seller2.id, items: [{ productId, quantity: "1", discountPct: "0" }] });
    expect((await getQuote(admin1, q.id)).seller.id).toBe(seller2.id);
  });

  it("un vendedor no puede asignar a otro", async () => {
    await expect(createQuote(seller, { ...base(), sellerId: seller2.id, items: [{ productId, quantity: "1", discountPct: "0" }] }))
      .rejects.toThrow(/Solo un administrador/);
    const q = await createQuote(seller, { ...base(), sellerId: seller.id, items: [{ productId, quantity: "1", discountPct: "0" }] });
    expect(q.sellerId).toBe(seller.id);
  });
});

describe("autorización de descuento", () => {
  it("sin descuento no pide autorización", async () => {
    const q = await createQuote(seller, { ...base(), items: [{ productId, quantity: "1", discountPct: "0" }] });
    expect(q.discountStatus).toBe("NONE");
  });

  it("el descuento del administrador queda autorizado sin avisos", async () => {
    const before = (await notes(admin2, "quote.discount_request")).length;
    const q = await createQuote(admin1, { ...base(), items: [{ productId, quantity: "1", discountPct: "0.1" }] });
    expect(q.discountStatus).toBe("APPROVED");
    expect(await notes(admin2, "quote.discount_request")).toHaveLength(before);
  });

  it("vendedor pide → todos los admins avisados → uno autoriza → todos saben quién", async () => {
    const q = await createQuote(seller, { ...base(), discountNote: "Cliente frecuente", items: [{ productId, quantity: "2", discountPct: "0.1" }] });
    expect(q.discountStatus).toBe("PENDING");
    for (const a of [admin1, admin2]) {
      const n = (await notes(a, "quote.discount_request")).find((x) => x.href === `/cotizaciones/${q.id}`);
      expect(n?.body).toMatch(/10%.*Cliente frecuente/);
    }
    // Bloqueada mientras está pendiente.
    await expect(changeQuoteStatus(seller, q.id, "SENT")).rejects.toThrow(/autorización/);
    await expect(decideDiscount(seller, q.id, true)).rejects.toThrow(/Solo un administrador/);

    await decideDiscount(admin1, q.id, true, "OK");
    const full = await getQuote(admin1, q.id);
    expect(full.discountStatus).toBe("APPROVED");
    expect(full.discountDecidedBy?.name).toBe(admin1.name);
    // El segundo administrador ya no puede decidir, pero sí recibe el aviso de quién autorizó.
    await expect(decideDiscount(admin2, q.id, false)).rejects.toThrow(/ya decidió/);
    const n2 = (await notes(admin2, "quote.discount_approved")).find((x) => x.href === `/cotizaciones/${q.id}`);
    expect(n2?.title).toContain(admin1.name);
    expect((await notes(seller, "quote.discount_approved")).some((x) => x.href === `/cotizaciones/${q.id}`)).toBe(true);
    expect(await db.approval.count({ where: { entityId: q.id, action: "discount.approve", decidedById: admin1.id } })).toBe(1);

    // Editar sin tocar el descuento lo conserva; cambiarlo lo vuelve a pedir.
    await updateQuote(seller, q.id, { ...base(), items: [{ productId, quantity: "2", discountPct: "0.1" }] });
    expect((await getQuote(seller, q.id)).discountStatus).toBe("APPROVED");
    await updateQuote(seller, q.id, { ...base(), items: [{ productId, quantity: "2", discountPct: "0.12" }] });
    expect((await getQuote(seller, q.id)).discountStatus).toBe("PENDING");
  });

  it("rechazado: no se envía hasta quitar el descuento", async () => {
    const q = await createQuote(seller, { ...base(), items: [{ productId, quantity: "1", discountPct: "0.05" }] });
    await decideDiscount(admin2, q.id, false, "Margen bajo");
    expect((await notes(admin1, "quote.discount_rejected")).some((x) => x.body?.includes("Margen bajo"))).toBe(true);
    await expect(changeQuoteStatus(seller, q.id, "SENT")).rejects.toThrow(/rechazó/);
    await updateQuote(seller, q.id, { ...base(), items: [{ productId, quantity: "1", discountPct: "0" }] });
    await changeQuoteStatus(seller, q.id, "SENT");
    expect((await getQuote(seller, q.id)).status).toBe("SENT");
  });
});
