import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { changeQuoteStatus, createQuote, getQuote, updateQuote } from "@/modules/quotes/service";
import { convertQuoteToSale, cancelSale, setSaleExpenses } from "@/modules/sales/service";
import { registerMovement, reverseMovement } from "@/modules/inventory/service";
import { saveProduct, setExchangeRate } from "@/modules/products/service";
import { registerPayment, voidPayment } from "@/modules/payments/service";
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

describe("lista de precios en USD", () => {
  it("la tubería se guarda en USD y se cotiza en MXN con el TC vigente (+IVA)", async () => {
    const tub = await saveProduct(admin, {
      sku: "TUB-1", description: "Tubo aluminio", line: "TUBERIA", kind: "PRODUCT", unit: "M", cost: "10", markup: "0.5",
      shipping: "1", consumables: "0.5", currency: "MXN", taxRate: "0.16", status: "ACTIVE",
    });
    expect(tub.currency).toBe("USD"); // forzado por ser tubería
    expect(tub.price.toString()).toBe("16.5"); // 10 + 50% + 1 traslado + 0.5 consumibles
    const item = { productId: tub.id, quantity: "2", discountPct: "0", details: "Instalación de 2 m" };
    await expect(createQuote(sellerA, { customerId: customerA, validUntil: validUntil(), items: [item] })).rejects.toThrow(/tipo de cambio/);
    await setExchangeRate(admin, "18.5");
    const q = await getQuote(admin, (await createQuote(sellerA, { customerId: customerA, validUntil: validUntil(), items: [item] })).id);
    const it0 = q.items[0];
    expect(it0.unitPrice.toString()).toBe("305.25"); // 16.5 USD × 18.5
    expect(it0.unitCost.toString()).toBe("212.75"); // (10 + 1 + 0.5) × 18.5
    expect(it0.origCurrency).toBe("USD");
    expect(it0.details).toBe("Instalación de 2 m");
    expect(q.total.toString()).toBe("708.18"); // 610.50 + 16% IVA
    await db.product.update({ where: { id: tub.id }, data: { status: "INACTIVE" } });
  });
});

describe("comisiones: meta mensual, cobro y % del mes de la O.C.", () => {
  it("solo comisiona lo cobrado; el cobro diferido conserva el % del mes de la O.C.", async () => {
    const lines = ["EQUIPO_VENTA", "RENTA", "REFACCIONES", "TUBERIA", "SERVICIOS", "KITS", "VALVULAS_OTROS"] as const;
    const v1 = await createRuleSetVersion(admin, {
      name: "T", basis: "MARGIN", rates: lines.map((line) => ({ line, rateMet: "0.07", rateNotMet: "0.035" })),
    });
    await activateRuleSet(admin, v1.id);

    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const prev = await createPeriod(admin, { name: "P-prev", startDate: new Date(Date.UTC(y, m - 1, 1)), endDate: new Date(Date.UTC(y, m, 0)) });
    const period = await createPeriod(admin, { name: "P-test", startDate: new Date(Date.UTC(y, m, 1)), endDate: new Date(Date.UTC(y, m + 1, 0)) });
    await expect(createPeriod(admin, { name: "X", startDate: new Date(Date.UTC(y, m, 2)), endDate: new Date(Date.UTC(y, m + 1, 0)) })).rejects.toThrow(/mensual/);
    await setTarget(admin, prev.id, sellerA.id, "1"); // mes N: meta cumplida
    await setTarget(admin, period.id, sellerA.id, "999999999"); // mes N+1: no cumplida

    // O.C. del mes N que se cobra en N+1, y O.C. del mes N+1 cobrada en N+1.
    const oldSale = await acceptedQuote("1").then((q) => convertQuoteToSale(sellerA, q.id, whId));
    await db.sale.update({ where: { id: oldSale.id }, data: { confirmedAt: new Date(Date.UTC(y, m - 1, 15, 18)) } });
    const newSale = await acceptedQuote("1").then((q) => convertQuoteToSale(sellerA, q.id, whId));

    await calculatePeriod(admin, period.id);
    expect(await db.commissionEntry.count({ where: { periodId: period.id } })).toBe(0); // sin cobro, sin comisión

    const today = new Date(Date.UTC(y, m, now.getDate()));
    for (const s of [oldSale, newSale]) await registerPayment(admin, s.id, { amount: s.total.toString(), paidAt: today, method: "TRANSFER" });

    await calculatePeriod(admin, prev.id);
    expect(await db.commissionEntry.count({ where: { periodId: prev.id } })).toBe(0); // cobrada en N+1: no se paga en N

    await calculatePeriod(admin, period.id);
    const entries = await db.commissionEntry.findMany({ where: { periodId: period.id } });
    const oldE = entries.filter((e) => e.saleId === oldSale.id);
    const newE = entries.filter((e) => e.saleId === newSale.id);
    expect(oldE.length).toBeGreaterThan(0);
    expect(oldE.every((e) => e.metTarget && e.rate.toString() === "0.07")).toBe(true); // % alto del mes N
    expect(newE.every((e) => !e.metTarget && e.rate.toString() === "0.035")).toBe(true); // % bajo del mes N+1
    const refa = newE.find((e) => e.line === "REFACCIONES")!;
    expect(refa.baseAmount.toString()).toBe("500"); // utilidad neta: 1500 − 1000
    expect(refa.amount.toString()).toBe("17.5");

    // Gastos de la venta reducen la utilidad comisionable.
    await setSaleExpenses(admin, newSale.id, "100");
    await calculatePeriod(admin, period.id);
    const refa2 = await db.commissionEntry.findFirstOrThrow({ where: { periodId: period.id, saleId: newSale.id, line: "REFACCIONES" } });
    expect(refa2.baseAmount.lt(500)).toBe(true);

    const v2 = await createRuleSetVersion(admin, {
      name: "T", basis: "MARGIN", rates: lines.map((line) => ({ line, rateMet: "0.5", rateNotMet: "0.5" })),
    });
    expect(v2.version).toBe(2);
    await approveSeller(admin, period.id, sellerA.id);
    await activateRuleSet(admin, v2.id);
    await expect(calculatePeriod(admin, period.id)).rejects.toThrow(/aprobadas/);
    const kept = await db.commissionEntry.findFirstOrThrow({ where: { id: refa2.id } });
    expect(kept.ruleSetId).toBe(v1.id);
    expect(kept.rate.toString()).toBe("0.035");
    const pay = await db.payment.findFirstOrThrow({ where: { saleId: newSale.id } });
    await expect(voidPayment(admin, pay.id, "prueba")).rejects.toThrow(/comisión/);
    await expect(setSaleExpenses(admin, newSale.id, "0")).rejects.toThrow(/aprobada/);
  });

  it("no se cancela una venta de un periodo con comisiones aprobadas", async () => {
    const sale = await db.sale.findFirstOrThrow({ where: { sellerId: sellerA.id, status: "CONFIRMED" } });
    await expect(cancelSale(admin, sale.id, "prueba de bloqueo")).rejects.toThrow(/aprobadas/);
  });
});

describe("complementos y garantía", () => {
  it("guarda la copia de los paquetes y la imprime en el PDF", async () => {
    const { renderQuotePdf } = await import("@/modules/quotes/pdf");
    const { execFileSync } = await import("node:child_process");
    const { writeFileSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const complements = [
      { code: "SERV-PISTON", name: "Servicio a pistón", activities: ["Drenado de lubricante", "Pruebas de funcionamiento"] },
      { code: "SERV-RENTA", name: "Renta de equipo", activities: [] },
    ];
    const created = await createQuote(sellerA, {
      customerId: customerA, validUntil: validUntil(), warrantyMonths: 1, complements,
      items: [{ productId: srvId, quantity: "1", discountPct: "0" }],
    });
    const q = await getQuote(sellerA, created.id);
    expect(q.complements).toEqual(complements);
    expect(q.warrantyMonths).toBe(1);
    const file = join(mkdtempSync(join(tmpdir(), "cot-")), "q.pdf");
    writeFileSync(file, await renderQuotePdf(q));
    const txt = execFileSync("pdftotext", [file, "-"]).toString();
    expect(txt).toContain("Complementos");
    expect(txt).toContain("SERV-PISTON");
    expect(txt).toContain("Pruebas de funcionamiento");
    expect(txt).toContain("SERV-RENTA");
    expect(txt).toMatch(/Garantía: 1 mes en unidades nuevas/);

    // Editar sin complementos deja la lista vacía (no vuelve al paquete de 8000 h).
    await updateQuote(sellerA, q.id, { customerId: customerA, validUntil: validUntil(), complements: [], items: [{ productId: srvId, quantity: "1", discountPct: "0" }] });
    expect((await getQuote(sellerA, q.id)).complements).toEqual([]);
  });
});

describe("paquetes compartidos", () => {
  it("un personalizado guardado sin compartir solo lo ve el admin", async () => {
    const { savePackageFromQuote, packageOptions } = await import("@/modules/complements/service");
    const code = await savePackageFromQuote(admin, { name: "Instalación línea nave 3", activities: ["Trazado"] }, false, 6);
    expect(code).toBe("P-INSTALACION-LINEA-NAVE-3");
    expect((await packageOptions(admin)).some((o) => o.code === code)).toBe(true);
    expect((await packageOptions(sellerA)).some((o) => o.code === code)).toBe(false);
    await db.complementPackage.update({ where: { code }, data: { shared: true } });
    expect((await packageOptions(sellerA)).some((o) => o.code === code)).toBe(true);
    expect(await savePackageFromQuote(admin, { name: "Instalación línea nave 3", activities: [] }, true, 3)).toBe(`${code}-2`);
  });
});
