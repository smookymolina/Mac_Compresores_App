import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { changeQuoteStatus, updateQuote } from "@/modules/quotes/service";
import { registerMovement } from "@/modules/inventory/service";
import { push } from "@/modules/sync/push";

let seller: CurrentUser, manager: CurrentUser, warehouse: CurrentUser, device: Device, otherDevice: Device, managerDevice: Device;
let whId: string, customerId: string, sepId: string;

async function mkUser(code: RoleCode, email: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id, mobileAccess: true } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

const mkDevice = (userId: string) =>
  db.device.create({ data: { userId, name: "Tel", platform: "ANDROID", appVersion: "1.0.0", tokenHash: randomUUID() } });

const validUntil = () => new Date(Date.now() + 7 * 864e5).toISOString();
const cmd = (type: string, payload: Record<string, unknown>, id = randomUUID()) =>
  ({ id, type, capturedAt: new Date().toISOString(), payload });
const quoteCmd = (extra: Record<string, unknown> = {}, qty = "1") => cmd("quote.create", {
  id: randomUUID(), customerId, validUntil: validUntil(), currency: "MXN",
  items: [{ productId: sepId, quantity: qty, discountPct: "0" }], ...extra,
});
const stock = async () =>
  (await db.stockBalance.findUniqueOrThrow({ where: { productId_warehouseId: { productId: sepId, warehouseId: whId } } })).quantity.toString();

beforeAll(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
  seller = await mkUser("VENTAS", "s@t");
  warehouse = await mkUser("ALMACEN", "w@t");
  manager = await mkUser("GERENCIA", "g@t");
  managerDevice = await mkDevice(manager.id);
  device = await mkDevice(seller.id);
  otherDevice = await mkDevice(seller.id);
  whId = (await db.warehouse.create({ data: { code: "T1", name: "Test" } })).id;
  customerId = (await db.customer.create({ data: { legalName: "Cliente", ownerId: seller.id } })).id;
  sepId = (await db.product.create({ data: { sku: "SEP", description: "Separador", line: "REFACCIONES", cost: 1000, price: 1500 } })).id;
  await registerMovement(warehouse, { productId: sepId, warehouseId: whId, type: "IN", quantity: "5", reason: "inicial" });
});

afterAll(() => db.$disconnect());

describe("sync push", () => {
  it("quote.create se aplica y reenviar el mismo comando devuelve el mismo resultado", async () => {
    const c = quoteCmd();
    const [r1] = await push(seller, device, [c]);
    expect(r1.status).toBe("APPLIED");
    const res = r1.result as { id: string; folio: number; total: string };
    expect(res.id).toBe(c.payload.id);
    expect(res.total).toBe("1740");
    const [r2] = await push(seller, device, [c]);
    expect(r2).toEqual(r1);
    expect(await db.quote.count({ where: { id: res.id } })).toBe(1);
    const q = await db.quote.findUniqueOrThrow({ where: { id: res.id } });
    expect(q.origin).toBe("MOBILE");
    expect(q.deviceId).toBe(device.id);
    expect(q.offlineCreatedAt?.toISOString()).toBe(c.capturedAt);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "quote.create", entityId: res.id } });
    expect((log.data as { deviceId?: string }).deviceId).toBe(device.id);
    // Otro comando con el mismo id de cotización (reintento tras perder la respuesta): misma cotización.
    const [r3] = await push(seller, device, [{ ...c, id: randomUUID() }]);
    expect(r3.status).toBe("APPLIED");
    expect((r3.result as { id: string }).id).toBe(res.id);
    expect(await db.quote.count({ where: { id: res.id } })).toBe(1);
  });

  it("transición imposible → REJECTED; payload inválido → REJECTED sin detener el resto", async () => {
    const c = quoteCmd();
    await push(seller, device, [c]);
    const out = await push(seller, device, [
      cmd("quote.status", { quoteId: c.payload.id, to: "ACCEPTED" }),
      cmd("quote.status", { quoteId: c.payload.id, to: "NOPE" }),
      cmd("quote.status", { quoteId: c.payload.id, to: "SENT" }),
    ]);
    expect(out.map((r) => r.status)).toEqual(["REJECTED", "REJECTED", "APPLIED"]);
    expect(out[0].error).toMatch(/No se puede pasar/);
    expect(await db.syncCommand.count({ where: { id: { in: out.map((r) => r.id) } } })).toBe(3);
  });

  it("quote.update con baseUpdatedAt viejo → CONFLICT", async () => {
    const c = quoteCmd();
    const [r] = await push(seller, device, [c]);
    const { id, updatedAt } = r.result as { id: string; updatedAt: string };
    // Alguien la edita en la web mientras el teléfono estaba sin red.
    await updateQuote(seller, id, { customerId, validUntil: new Date(validUntil()), currency: "MXN", items: [{ productId: sepId, quantity: "3", discountPct: "0" }] });
    const [u] = await push(seller, device, [cmd("quote.update", {
      quoteId: id, baseUpdatedAt: updatedAt, customerId, validUntil: validUntil(), currency: "MXN",
      items: [{ productId: sepId, quantity: "2", discountPct: "0" }],
    })]);
    expect(u.status).toBe("CONFLICT");
    expect((await db.quoteItem.findFirstOrThrow({ where: { quoteId: id } })).quantity.toString()).toBe("3");
    // Con la versión vigente sí se aplica.
    const fresh = await db.quote.findUniqueOrThrow({ where: { id } });
    const [ok] = await push(seller, device, [cmd("quote.update", {
      quoteId: id, baseUpdatedAt: fresh.updatedAt.toISOString(), customerId, validUntil: validUntil(), currency: "MXN",
      items: [{ productId: sepId, quantity: "2", discountPct: "0" }],
    })]);
    expect(ok.status).toBe("APPLIED");
  });

  it("sale.convert dos veces (comandos distintos): la segunda no aplica e inventario baja una vez", async () => {
    const c = quoteCmd({}, "2");
    await push(seller, device, [c]);
    const quoteId = c.payload.id as string;
    await changeQuoteStatus(seller, quoteId, "SENT");
    await changeQuoteStatus(seller, quoteId, "ACCEPTED");
    const before = await stock();
    const [a] = await push(seller, device, [cmd("sale.convert", { quoteId, warehouseId: whId })]);
    const [b] = await push(seller, otherDevice, [cmd("sale.convert", { quoteId, warehouseId: whId })]);
    expect(a.status).toBe("APPLIED");
    // Idempotente por quoteId: la segunda devuelve la venta existente.
    expect(b.status).toBe("APPLIED");
    expect((b.result as { saleId: string }).saleId).toBe((a.result as { id: string }).id);
    expect(await db.sale.count({ where: { quoteId } })).toBe(1);
    expect(Number(before) - Number(await stock())).toBe(2);
  });

  it("payment.register reintentado es idempotente (VENTAS sin permiso → REJECTED)", async () => {
    const sale = await db.sale.findFirstOrThrow({ where: { sellerId: seller.id } });
    const pay = cmd("payment.register", { id: randomUUID(), saleId: sale.id, amount: "100.50", paidAt: new Date().toISOString(), method: "CASH" });
    const [denied] = await push(seller, device, [{ ...pay, id: randomUUID() }]);
    expect(denied.status).toBe("REJECTED");
    const [r1] = await push(manager, managerDevice, [pay]);
    expect(r1.status).toBe("APPLIED");
    const [r2] = await push(manager, managerDevice, [pay]);
    expect(r2).toEqual(r1);
    const [r3] = await push(manager, managerDevice, [{ ...pay, id: randomUUID() }]); // mismo pago, otro comando
    expect(r3.status).toBe("APPLIED");
    expect(await db.payment.count({ where: { saleId: sale.id } })).toBe(1);
  });

  it("folio apartado se usa una sola vez y solo por su dispositivo", async () => {
    const [{ folio }] = await db.$queryRaw<{ folio: bigint }[]>`SELECT nextval(pg_get_serial_sequence('"Quote"', 'folio')) AS folio`;
    await db.reservedFolio.create({ data: { folio: Number(folio), deviceId: device.id } });
    const [foreign] = await push(seller, otherDevice, [quoteCmd({ folio: Number(folio) })]);
    expect(foreign.status).toBe("CONFLICT");
    const [a] = await push(seller, device, [quoteCmd({ folio: Number(folio) })]);
    expect(a.status).toBe("APPLIED");
    expect((a.result as { folio: number }).folio).toBe(Number(folio));
    expect((await db.reservedFolio.findUniqueOrThrow({ where: { folio: Number(folio) } })).usedAt).not.toBeNull();
    const [b] = await push(seller, device, [quoteCmd({ folio: Number(folio) })]);
    expect(b.status).toBe("CONFLICT");
    expect(await db.quote.count({ where: { folio: Number(folio) } })).toBe(1);
  });

  it("customer.save crea con id del teléfono y luego actualiza", async () => {
    const id = randomUUID();
    const [a] = await push(seller, device, [cmd("customer.save", { id, legalName: "Nuevo Campo", paymentTermsDays: 30, contact: { name: "Ana" } })]);
    expect(a.status).toBe("APPLIED");
    const [b] = await push(seller, device, [cmd("customer.save", { id, legalName: "Nuevo Campo SA", paymentTermsDays: 15 })]);
    expect(b.status).toBe("APPLIED");
    const c = await db.customer.findUniqueOrThrow({ where: { id }, include: { contacts: true } });
    expect([c.legalName, c.ownerId, c.contacts.length]).toEqual(["Nuevo Campo SA", seller.id, 1]);
  });

  it("sin permiso → REJECTED; más de 100 comandos → error", async () => {
    const [r] = await push(warehouse, device, [quoteCmd()]);
    expect(r.status).toBe("REJECTED");
    await expect(push(seller, device, Array.from({ length: 101 }, () => quoteCmd()))).rejects.toThrow(/Máximo 100/);
  });
});
