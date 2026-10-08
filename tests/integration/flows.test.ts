import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { dec } from "@/lib/money";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { changeQuoteStatus, createQuote, getQuote, updateQuote } from "@/modules/quotes/service";
import { convertQuoteToSale, cancelSale } from "@/modules/sales/service";
import { registerMovement, reverseMovement } from "@/modules/inventory/service";
import { saveProduct } from "@/modules/products/service";
import {
  activateRuleSet, approveSeller, calculatePeriod, createPeriod, createRuleSetVersion, setTarget,
} from "@/modules/commissions/service";

let admin: CurrentUser, sellerA: CurrentUser, sellerB: CurrentUser, warehouse: CurrentUser;
let whId: string, customerA: string, sepId: string, srvId: string;

async function mkUser(code: RoleCode, email: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

beforeAll(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);

  admin = await mkUser("ADMIN", "admin@t");
  sellerA = await mkUser("VENTAS", "a@t");
  sellerB = await mkUser("VENTAS", "b@t");
  warehouse = await mkUser("ALMACEN", "w@t");
  whId = (await db.warehouse.create({ data: { code: "T1", name: "Test" } })).id;
  customerA = (await db.customer.create({ data: { legalName: "Cliente A", ownerId: sellerA.id } })).id;
  sepId = (await db.product.create({ data: { sku: "SEP", description: "Separador", line: "REFACCIONES", cost: 1000, price: 1500 } })).id;
  srvId = (await db.product.create({ data: { sku: "SRV", description: "Servicio", line: "SERVICIOS", kind: "SERVICE", price: 3500 } })).id;
  await registerMovement(warehouse, { productId: sepId, warehouseId: whId, type: "IN", quantity: "5", reason: "inicial" });
});

afterAll(() => db.$disconnect());

const validUntil = () => new Date(Date.now() + 7 * 864e5);

async function acceptedQuote(qty = "2") {
  const q = await createQuote(sellerA, {
    customerId: customerA, validUntil: validUntil(),
    items: [{ productId: sepId, quantity: qty, discountPct: "0" }, { productId: srvId, quantity: "1", discountPct: "0.1" }],
  });
  await changeQuoteStatus(sellerA, q.id, "SENT");
  await changeQuoteStatus(sellerA, q.id, "ACCEPTED");
  return q;
}

describe("autorización por objeto", () => {
  it("un vendedor no ve ni opera cotizaciones de otro", async () => {
    const q = await createQuote(sellerA, { customerId: customerA, validUntil: validUntil(), items: [{ productId: sepId, quantity: "1", discountPct: "0" }] });
    await expect(getQuote(sellerB, q.id)).rejects.toThrow(/no encontrada/);
    await expect(changeQuoteStatus(sellerB, q.id, "SENT")).rejects.toThrow();
    await expect(createQuote(sellerB, { customerId: customerA, validUntil: validUntil(), items: [{ productId: sepId, quantity: "1", discountPct: "0" }] }))
      .rejects.toThrow(/Cliente no encontrado/);
    await expect(getQuote(admin, q.id)).resolves.toBeTruthy();
  });
});

describe("cotizaciones", () => {
  it("congela precios aunque cambie el catálogo", async () => {
    const q = await createQuote(sellerA, { customerId: customerA, validUntil: validUntil(), items: [{ productId: sepId, quantity: "1", discountPct: "0" }] });
    const p = await db.product.findUniqueOrThrow({ where: { id: sepId } });
    await saveProduct(admin, {
      sku: p.sku, description: p.description, line: p.line, kind: p.kind, unit: p.unit, cost: "1200", markup: "0",
      shipping: "0", price: "1999", taxRate: "0.16", status: "ACTIVE",
    }, sepId);
    const after = await getQuote(admin, q.id);
    expect(after.items[0].unitPrice.toString()).toBe("1500");
    expect(after.total.toString()).toBe("1740");
    await db.product.update({ where: { id: sepId }, data: { price: 1500, cost: 1000 } });
    expect(await db.priceHistory.count({ where: { productId: sepId } })).toBe(1);
  });

  it("solo edita borradores y no acepta vencidas", async () => {
    const q = await createQuote(sellerA, { customerId: customerA, validUntil: new Date(Date.now() - 2 * 864e5), items: [{ productId: sepId, quantity: "1", discountPct: "0" }] });
    await changeQuoteStatus(sellerA, q.id, "SENT");
    await expect(updateQuote(sellerA, q.id, { customerId: customerA, validUntil: validUntil(), items: [{ productId: sepId, quantity: "9", discountPct: "0" }] }))
      .rejects.toThrow(/borrador/);
    await expect(changeQuoteStatus(sellerA, q.id, "ACCEPTED")).rejects.toThrow(/vencida/);
  });
});

describe("ventas e inventario", () => {
  it("conversión concurrente procesa una sola vez y descuenta inventario una vez", async () => {
    const before = await db.stockBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: sepId, warehouseId: whId } } });
    const q = await acceptedQuote("2");
    const results = await Promise.allSettled([1, 2, 3].map(() => convertQuoteToSale(sellerA, q.id, whId)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.sale.count({ where: { quoteId: q.id } })).toBe(1);
    const after = await db.stockBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: sepId, warehouseId: whId } } });
    expect(before.quantity.sub(after.quantity).toString()).toBe("2");
    expect((await getQuote(sellerA, q.id)).status).toBe("CONVERTED");
  });

  it("sin existencia suficiente revierte toda la transacción", async () => {
    const q = await acceptedQuote("999");
    await expect(convertQuoteToSale(sellerA, q.id, whId)).rejects.toThrow(/insuficiente/);
    expect((await getQuote(sellerA, q.id)).status).toBe("ACCEPTED");
    expect(await db.sale.count({ where: { quoteId: q.id } })).toBe(0);
  });

  it("salidas concurrentes nunca dejan stock negativo", async () => {
    const bal = await db.stockBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: sepId, warehouseId: whId } } });
    const n = bal.quantity.toNumber();
    const res = await Promise.allSettled(Array.from({ length: n + 2 }, () =>
      registerMovement(warehouse, { productId: sepId, warehouseId: whId, type: "OUT", quantity: "1", reason: "prueba" })));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(n);
    const after = await db.stockBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: sepId, warehouseId: whId } } });
    expect(after.quantity.toString()).toBe("0");
  });

  it("reversa compensatoria única", async () => {
    const mv = await registerMovement(warehouse, { productId: sepId, warehouseId: whId, type: "IN", quantity: "10", reason: "compra" });
    await reverseMovement(warehouse, mv.id, "error de captura");
    await expect(reverseMovement(warehouse, mv.id, "otra vez")).rejects.toThrow(/ya fue revertido/);
    await expect(registerMovement(warehouse, { productId: srvId, warehouseId: whId, type: "IN", quantity: "1", reason: "x" })).rejects.toThrow(/servicio/);
    await registerMovement(warehouse, { productId: sepId, warehouseId: whId, type: "IN", quantity: "10", reason: "compra" });
  });
});

describe("comisiones versionadas", () => {
  it("calcula con la regla activa, conserva la versión y bloquea recálculo tras aprobar", async () => {
    const lines = ["EQUIPO_VENTA", "RENTA", "REFACCIONES", "TUBERIA", "SERVICIOS", "KITS", "VALVULAS_OTROS"] as const;
    const v1 = await createRuleSetVersion(admin, {
      name: "T", basis: "NET_SALES", rates: lines.map((line) => ({ line, rateMet: "0.07", rateNotMet: "0.035" })),
    });
    await activateRuleSet(admin, v1.id);
    await acceptedQuote("1").then((q) => convertQuoteToSale(sellerA, q.id, whId));

    const today = new Date();
    const start = new Date(Date.UTC(today.getFullYear(), today.getMonth(), 1));
    const end = new Date(Date.UTC(today.getFullYear(), today.getMonth() + 1, 0));
    const period = await createPeriod(admin, { name: "P-test", startDate: start, endDate: end });
    await setTarget(admin, period.id, sellerA.id, "1"); // meta mínima → cumplida

    await calculatePeriod(admin, period.id);
    const entries = await db.commissionEntry.findMany({ where: { periodId: period.id, sellerId: sellerA.id } });
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.ruleSetId === v1.id && e.metTarget)).toBe(true);
    const refa = entries.find((e) => e.line === "REFACCIONES")!;
    expect(refa.amount.toString()).toBe(refa.baseAmount.mul("0.07").toDecimalPlaces(2).toString());

    const v2 = await createRuleSetVersion(admin, {
      name: "T", basis: "NET_SALES", rates: lines.map((line) => ({ line, rateMet: "0.5", rateNotMet: "0.5" })),
    });
    expect(v2.version).toBe(2);
    await approveSeller(admin, period.id, sellerA.id);
    await activateRuleSet(admin, v2.id);
    await expect(calculatePeriod(admin, period.id)).rejects.toThrow(/aprobadas/);
    const kept = await db.commissionEntry.findFirstOrThrow({ where: { id: refa.id } });
    expect(kept.ruleSetId).toBe(v1.id);
    expect(kept.rate.toString()).toBe("0.07");
    expect(dec(kept.amount).eq(refa.amount)).toBe(true);
  });

  it("no se cancela una venta de un periodo con comisiones aprobadas", async () => {
    const sale = await db.sale.findFirstOrThrow({ where: { sellerId: sellerA.id, status: "CONFIRMED" } });
    await expect(cancelSale(admin, sale.id, "prueba de bloqueo")).rejects.toThrow(/aprobadas/);
  });
});
