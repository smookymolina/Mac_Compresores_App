import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { listProducts } from "@/modules/products/service";
import { describeDetail, actionLabel } from "@/modules/audit/labels";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { createQuote, getQuote } from "@/modules/quotes/service";
import { renderQuotePdf } from "@/modules/quotes/pdf";

const tag = `v132-${Date.now()}`;

afterAll(async () => {
  await db.quote.deleteMany({ where: { customer: { legalName: { startsWith: tag } } } });
  await db.customer.deleteMany({ where: { legalName: { startsWith: tag } } });
  await db.product.deleteMany({ where: { sku: { startsWith: tag } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

describe("búsqueda de productos sin acentos", () => {
  it("encuentra con o sin acentos y mayúsculas, también tras editar", async () => {
    const p = await db.product.create({ data: { sku: `${tag}-A`, description: "Válvula de seguridad Compresión", line: "VALVULAS_OTROS", price: 10 } });
    for (const term of ["valvula", "VÁLVULA", "compresion", "Compresión"]) {
      const r = await listProducts({ search: term });
      expect(r.items.map((x) => x.id), term).toContain(p.id);
    }
    await db.product.update({ where: { id: p.id }, data: { description: "Separador aire/aceite" } });
    expect((await listProducts({ search: "valvula" })).items.map((x) => x.id)).not.toContain(p.id);
    expect((await listProducts({ search: "separador" })).items.map((x) => x.id)).toContain(p.id);
  });
});

describe("auditoría legible", () => {
  it("traduce acción y detalle", () => {
    expect(actionLabel("quote.status")).toBe("Cambio de estado de cotización");
    const d = describeDetail("quote.status", { from: "SENT", to: "ACCEPTED" }, new Map());
    expect(d).toEqual([{ label: "De", value: "Enviada" }, { label: "Para", value: "Aceptada" }]);
    const u = describeDetail("user.update", { roleFrom: "a", roleTo: "a", active: true }, new Map());
    expect(u).toEqual([{ label: "Activo", value: "Sí" }]);
  });
});

describe("tiempo de entrega", () => {
  it("se guarda en la cotización y sale en el PDF", async () => {
    const role = await db.role.upsert({ where: { code: "ADMIN" }, create: { code: "ADMIN", name: "ADMIN" }, update: {} });
    const u = await db.user.create({ data: { email: `${tag}@t`, name: "Vendedor v132", passwordHash: "x", roleId: role.id } });
    const user = { id: u.id, name: u.name, email: u.email, role: "ADMIN" as const, roleName: "ADMIN", permissions: new Set(ROLE_PERMISSIONS.ADMIN) };
    const customerId = (await db.customer.create({ data: { legalName: `${tag} Cliente`, ownerId: u.id } })).id;
    const productId = (await db.product.create({ data: { sku: `${tag}-S`, description: "Mantenimiento preventivo", line: "SERVICIOS", kind: "SERVICE", price: 500 } })).id;
    const q = await createQuote(user, {
      customerId, validUntil: new Date(Date.now() + 7 * 864e5), deliveryTime: "5 días hábiles a partir de la orden de compra",
      items: [{ productId, quantity: "1", discountPct: "0" }],
    });
    const full = await getQuote(user, q.id);
    expect(full.deliveryTime).toBe("5 días hábiles a partir de la orden de compra");
    const pdf = await renderQuotePdf(full);
    expect(pdf.length).toBeGreaterThan(1000);
    if (process.env.PDF_OUT) (await import("node:fs")).writeFileSync(process.env.PDF_OUT, pdf);
  });
});
