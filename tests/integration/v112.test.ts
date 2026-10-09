import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";

const sent: { to: unknown; subject: string; attachments?: { filename: string }[]; replyTo?: string }[] = [];
vi.mock("@/lib/mail", () => ({
  isMailConfigured: () => true,
  sendMail: async (m: (typeof sent)[number]) => { sent.push(m); },
}));

const { createQuote, changeQuoteStatus, getQuote } = await import("@/modules/quotes/service");
const { convertQuoteToSale, cancelSale } = await import("@/modules/sales/service");
const { registerMovement } = await import("@/modules/inventory/service");
const { registerPayment, voidPayment, listReceivables } = await import("@/modules/payments/service");
const { hit, isLimited, clear } = await import("@/lib/rate-limit");
const { runDailyJob, todayMx } = await import("@/modules/jobs/daily");
const { buildReport } = await import("@/modules/reports/service");
const { emailQuote } = await import("@/modules/quotes/email");
const { globalSearch } = await import("@/modules/search/service");

let admin: CurrentUser, seller: CurrentUser, other: CurrentUser, warehouse: CurrentUser;
let whId: string, customerId: string, productId: string;
const tag = `v112-${Date.now()}`;

async function mkUser(code: RoleCode, email: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

async function confirmedSale(total = "1") {
  const q = await createQuote(seller, { customerId, validUntil: new Date(Date.now() + 7 * 864e5), items: [{ productId, quantity: total, discountPct: "0" }] });
  await changeQuoteStatus(seller, q.id, "SENT");
  await changeQuoteStatus(seller, q.id, "ACCEPTED");
  return convertQuoteToSale(seller, q.id, whId);
}

beforeAll(async () => {
  process.env.APP_URL = "https://app.test";
  admin = await mkUser("ADMIN", `admin-${tag}@t`);
  seller = await mkUser("VENTAS", `seller-${tag}@t`);
  other = await mkUser("VENTAS", `other-${tag}@t`);
  warehouse = await mkUser("ALMACEN", `wh-${tag}@t`);
  // Permisos en BD: usersWithPermission (avisos del trabajo diario) los lee de ahí.
  for (const code of ["inventory.write", "payments.write"] as const) {
    const perm = await db.permission.upsert({ where: { code }, create: { code }, update: {} });
    for (const r of ["ALMACEN", "ADMIN"] as const) {
      if (!ROLE_PERMISSIONS[r].includes(code)) continue;
      const role = await db.role.findUniqueOrThrow({ where: { code: r } });
      await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
    }
  }
  whId = (await db.warehouse.create({ data: { code: tag, name: "Test v112" } })).id;
  customerId = (await db.customer.create({ data: { legalName: `Cliente ${tag}`, email: `cliente-${tag}@t`, ownerId: seller.id, paymentTermsDays: 30 } })).id;
  productId = (await db.product.create({ data: { sku: `SKU-${tag}`, description: "Filtro v112", line: "REFACCIONES", cost: 50, price: 100 } })).id;
  await registerMovement(warehouse, { productId, warehouseId: whId, type: "IN", quantity: "100", reason: "inicial" });
});

afterAll(() => db.$disconnect());

describe("cobranza", () => {
  it("no permite pagar de más, ni siquiera con pagos simultáneos", async () => {
    const sale = await confirmedSale("1"); // total 116.00
    const results = await Promise.allSettled([1, 2, 3].map(() => registerPayment(admin, sale.id, { amount: "60", paidAt: new Date(), method: "TRANSFER" })));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(registerPayment(admin, sale.id, { amount: "56.01", paidAt: new Date(), method: "CASH" })).rejects.toThrow(/rebasa el saldo/);
    await registerPayment(admin, sale.id, { amount: "56", paidAt: new Date(), method: "CASH" });
    expect((await listReceivables(admin)).some((r) => r.id === sale.id)).toBe(false);
  });

  it("un vendedor no registra pagos; anular devuelve el saldo y bloquea cancelar mientras haya pagos", async () => {
    const sale = await confirmedSale("1");
    await expect(registerPayment(seller, sale.id, { amount: "10", paidAt: new Date(), method: "CASH" })).rejects.toThrow(/permiso/);
    const p = await registerPayment(admin, sale.id, { amount: "16", paidAt: new Date(), method: "CASH" });
    await expect(cancelSale(admin, sale.id, "prueba de cancelación")).rejects.toThrow(/pagos registrados/);
    expect((await listReceivables(admin)).find((r) => r.id === sale.id)?.balance.toString()).toBe("100");
    await voidPayment(admin, p.id, "captura errónea");
    await expect(voidPayment(admin, p.id, "otra vez")).rejects.toThrow(/ya estaba anulado/);
    expect((await listReceivables(admin)).find((r) => r.id === sale.id)?.balance.toString()).toBe("116");
    await cancelSale(admin, sale.id, "prueba de cancelación");
  });
});

describe("límite de intentos", () => {
  it("cuenta de forma atómica y se limpia", async () => {
    const key = `test:${tag}`;
    const counts = await Promise.all(Array.from({ length: 6 }, () => hit(key, 60_000)));
    expect(counts.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await isLimited(key, 5)).toBe(true);
    await clear(key);
    expect(await isLimited(key, 5)).toBe(false);
  });
});

describe("trabajo diario", () => {
  it("vence cotizaciones enviadas pasadas, avisa por vencer y no duplica avisos", async () => {
    const today = todayMx().date;
    const past = await createQuote(seller, { customerId, validUntil: new Date(today.getTime() - 864e5), items: [{ productId, quantity: "1", discountPct: "0" }] });
    await changeQuoteStatus(seller, past.id, "SENT");
    const soon = await createQuote(seller, { customerId, validUntil: new Date(today.getTime() + 2 * 864e5), items: [{ productId, quantity: "1", discountPct: "0" }] });
    await changeQuoteStatus(seller, soon.id, "SENT");
    await db.stockBalance.update({ where: { productId_warehouseId: { productId, warehouseId: whId } }, data: { minStock: 1000 } });

    sent.length = 0;
    const r1 = await runDailyJob();
    expect(r1.expiredQuotes).toBeGreaterThanOrEqual(1);
    expect((await getQuote(seller, past.id)).status).toBe("EXPIRED");
    expect((await getQuote(seller, soon.id)).status).toBe("SENT");
    expect(await db.notification.count({ where: { userId: seller.id, kind: "quote.expiring" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: warehouse.id, kind: "stock.low" } })).toBe(1);
    expect(sent.some((m) => m.to === seller.email)).toBe(true);

    await runDailyJob(); // segunda corrida el mismo día: sin avisos repetidos
    expect(await db.notification.count({ where: { userId: seller.id, kind: "quote.expiring" } })).toBe(1);
    expect(await db.notification.count({ where: { userId: warehouse.id, kind: "stock.low" } })).toBe(1);
    await db.stockBalance.update({ where: { productId_warehouseId: { productId, warehouseId: whId } }, data: { minStock: 0 } });
  });

  it("avisa al vendedor cuando otro usuario cambia su cotización", async () => {
    const q = await createQuote(seller, { customerId, validUntil: new Date(Date.now() + 7 * 864e5), items: [{ productId, quantity: "1", discountPct: "0" }] });
    await changeQuoteStatus(seller, q.id, "SENT");
    await changeQuoteStatus(admin, q.id, "ACCEPTED");
    expect(await db.notification.count({ where: { userId: seller.id, kind: "quote.status", href: `/cotizaciones/${q.id}` } })).toBe(1);
  });
});

describe("correo de cotización", () => {
  it("adjunta el PDF, responde al vendedor y pasa el borrador a «Enviada»", async () => {
    const q = await createQuote(seller, { customerId, validUntil: new Date(Date.now() + 7 * 864e5), items: [{ productId, quantity: "1", discountPct: "0" }] });
    sent.length = 0;
    await emailQuote(seller, q.id, { to: [`cliente-${tag}@t`], cc: [], message: "Adjunto" });
    expect(sent[0]!.attachments![0]!.filename).toBe(`cotizacion-C${q.folio}.pdf`);
    expect(sent[0]!.replyTo).toBe(seller.email);
    expect((await getQuote(seller, q.id)).status).toBe("SENT");
    await expect(emailQuote(other, q.id, { to: ["x@t"], cc: [], message: "x" })).rejects.toThrow(/no encontrada/);
  });
});

describe("reportes y búsqueda", () => {
  it("exporta CSV con BOM y requiere permiso", async () => {
    const from = new Date(Date.now() - 864e5), to = new Date();
    const { csv, filename } = await buildReport(admin, "ventas", from, to);
    expect(csv.startsWith("﻿Venta,Cotización,Fecha")).toBe(true);
    expect(filename).toMatch(/^ventas_/);
    await expect(buildReport(seller, "ventas", from, to)).rejects.toThrow(/permiso/);
  });

  it("la búsqueda respeta el alcance del vendedor", async () => {
    const mine = await globalSearch(seller, tag);
    expect(mine.some((h) => h.group === "Clientes")).toBe(true);
    const theirs = await globalSearch(other, `Cliente ${tag}`);
    expect(theirs.some((h) => h.group === "Clientes" || h.group === "Cotizaciones")).toBe(false);
  });
});
