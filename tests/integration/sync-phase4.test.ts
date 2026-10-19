import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { hashToken, type CurrentUser } from "@/lib/auth/session";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type RoleCode } from "@/lib/auth/permissions";
import { newDeviceToken } from "@/modules/sync/device";
import { push } from "@/modules/sync/push";
import { rejectSyncConflict, retrySyncConflict, revokeDevice } from "@/modules/sync/admin";
import { changeQuoteStatus } from "@/modules/quotes/service";
import { registerMovement } from "@/modules/inventory/service";
import type { DuplicateRfcResult, StockConflictResult } from "@/modules/sync/protocol";

let seller: CurrentUser, manager: CurrentUser, almacen: CurrentUser, admin: CurrentUser;
let device: Device, managerDevice: Device, almacenDevice: Device;
let customerId: string, p1: string, wh1: string, wh2: string;

async function mkUser(code: RoleCode, email: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  for (const c of ROLE_PERMISSIONS[code]) {
    const p = await db.permission.upsert({ where: { code: c }, create: { code: c }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, create: { roleId: role.id, permissionId: p.id }, update: {} });
  }
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id, mobileAccess: true } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}
const mkDevice = (userId: string) =>
  db.device.create({ data: { userId, name: "Tel", platform: "ANDROID", appVersion: "1.4.0", tokenHash: hashToken(newDeviceToken()) } });
const cmd = (type: string, payload: Record<string, unknown>, capturedAt = new Date()) =>
  ({ id: randomUUID(), type, capturedAt: capturedAt.toISOString(), payload });
const qty = async (warehouseId: string) =>
  (await db.stockBalance.findUnique({ where: { productId_warehouseId: { productId: p1, warehouseId } } }))?.quantity.toString() ?? "0";

/** Cotización ACEPTADA del vendedor por `n` piezas de P1. */
async function acceptedQuote(n: string) {
  const c = cmd("quote.create", {
    id: randomUUID(), customerId, validUntil: new Date(Date.now() + 7 * 864e5).toISOString(), currency: "MXN",
    items: [{ productId: p1, quantity: n, discountPct: "0" }],
  });
  const [r] = await push(seller, device, [c]);
  expect(r.status).toBe("APPLIED");
  const quoteId = c.payload.id as string;
  await changeQuoteStatus(seller, quoteId, "SENT");
  await changeQuoteStatus(seller, quoteId, "ACCEPTED");
  return quoteId;
}

beforeAll(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
  seller = await mkUser("VENTAS", "s@t");
  manager = await mkUser("GERENCIA", "g@t");
  almacen = await mkUser("ALMACEN", "w@t");
  admin = { ...(await mkUser("ADMIN", "a@t")), permissions: new Set<Permission>(PERMISSIONS) };
  device = await mkDevice(seller.id);
  managerDevice = await mkDevice(manager.id);
  almacenDevice = await mkDevice(almacen.id);
  wh1 = (await db.warehouse.create({ data: { code: "W1", name: "Matriz" } })).id;
  wh2 = (await db.warehouse.create({ data: { code: "W2", name: "Sucursal" } })).id;
  customerId = (await db.customer.create({ data: { legalName: "Cliente", ownerId: seller.id, phone: "111", notes: "orig" } })).id;
  p1 = (await db.product.create({ data: { sku: "P1", description: "Pieza", line: "REFACCIONES", cost: 500, price: 1000 } })).id;
  await registerMovement(almacen, { productId: p1, warehouseId: wh1, type: "IN", quantity: "1", reason: "inicial" });
  await registerMovement(almacen, { productId: p1, warehouseId: wh2, type: "IN", quantity: "10", reason: "inicial" });
});

afterAll(() => db.$disconnect());

describe("clientes (fusión por campo, contactos y direcciones)", () => {
  it("changedFields solo cambia los campos indicados y audita customer.merge", async () => {
    const base = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    await db.customer.update({ where: { id: customerId }, data: { notes: "web" } }); // edición web posterior
    const [r] = await push(seller, device, [cmd("customer.save", {
      id: customerId, legalName: "Nombre viejo", phone: "222", notes: "tel", paymentTermsDays: 0,
      baseUpdatedAt: base.updatedAt.toISOString(), changedFields: ["phone"],
    })]);
    expect(r.status).toBe("APPLIED");
    const c = await db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect([c.legalName, c.phone, c.notes]).toEqual(["Cliente", "222", "web"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "customer.merge", entityId: customerId } });
    expect(log.data).toMatchObject({ fields: ["phone"], serverChangedSinceBase: true });
  });

  it("RFC duplicado → CONFLICT duplicate_rfc; rechazar notifica", async () => {
    await db.customer.create({ data: { legalName: "Otro", rfc: "AAA010101AAA" } });
    const [r] = await push(seller, device, [cmd("customer.save", { id: randomUUID(), legalName: "Nuevo", rfc: "aaa010101aaa", paymentTermsDays: 0 })]);
    expect(r.status).toBe("CONFLICT");
    expect(r.result as DuplicateRfcResult).toEqual({ kind: "duplicate_rfc", rfc: "AAA010101AAA" });
    await rejectSyncConflict(admin, r.id);
    expect((await db.syncCommand.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("REJECTED");
    expect(await db.notification.count({ where: { userId: seller.id, kind: "sync.conflict" } })).toBe(1);
  });

  it("contacto y dirección: agregar/quitar idempotentes por id", async () => {
    const contactId = randomUUID(), addressId = randomUUID();
    const addC = { customerId, id: contactId, name: "Ana López", email: "ana@x.mx" };
    const addA = { customerId, id: addressId, label: "Planta", street: "Calle 1", city: "León" };
    const res = await push(seller, device, [
      cmd("customer.contact.add", addC), cmd("customer.contact.add", addC),
      cmd("customer.address.add", addA), cmd("customer.address.add", addA),
    ]);
    expect(res.map((r) => r.status)).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED"]);
    expect(res[1]!.result).toEqual(res[0]!.result);
    expect(await db.customerContact.count({ where: { customerId } })).toBe(1);
    expect((await db.customerAddress.findUniqueOrThrow({ where: { id: addressId } })).label).toBe("Planta");
    const rm = await push(seller, device, [
      cmd("customer.contact.remove", { customerId, contactId }), cmd("customer.contact.remove", { customerId, contactId }),
      cmd("customer.address.remove", { customerId, addressId }), cmd("customer.address.remove", { customerId, addressId }),
    ]);
    expect(rm.map((r) => r.status)).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED"]);
    expect(await db.customerContact.count({ where: { customerId } })).toBe(0);
    expect(await db.customerAddress.count({ where: { customerId } })).toBe(0);
  });
});

describe("ventas sin existencia", () => {
  it("CONFLICT stock → convertir desde otro almacén (descuenta una vez, ahí)", async () => {
    const quoteId = await acceptedQuote("3");
    const [r] = await push(seller, device, [cmd("sale.convert", { quoteId, warehouseId: wh1 })]);
    expect(r.status).toBe("CONFLICT");
    expect(r.result as StockConflictResult).toEqual({ kind: "stock", warehouseId: wh1, items: [{ productId: p1, sku: "P1", requested: "3", available: "1" }] });
    await retrySyncConflict(admin, r.id, { warehouseId: wh2 });
    await expect(retrySyncConflict(admin, r.id, { warehouseId: wh2 })).rejects.toThrow();
    expect([await qty(wh1), await qty(wh2)]).toEqual(["1", "7"]);
    const sale = await db.sale.findUniqueOrThrow({ where: { quoteId } });
    expect(sale.warehouseId).toBe(wh2);
    expect((await db.syncCommand.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPLIED");
    // Reenviar el comando o convertir otra vez: misma venta (idempotente por quoteId).
    const [again] = await push(seller, device, [cmd("sale.convert", { quoteId, warehouseId: wh1 })]);
    expect(again).toMatchObject({ status: "APPLIED", result: { saleId: sale.id, folio: sale.folio } });
    expect(await qty(wh2)).toBe("7");
  });

  it("reintentar después de una entrada de inventario", async () => {
    const quoteId = await acceptedQuote("2");
    const [r] = await push(seller, device, [cmd("sale.convert", { quoteId, warehouseId: wh1 })]);
    expect(r.status).toBe("CONFLICT");
    await expect(retrySyncConflict(admin, r.id)).rejects.toThrow(/Sigue sin poder aplicarse/);
    const still = await db.syncCommand.findUniqueOrThrow({ where: { id: r.id } });
    expect([still.status, still.resolvedAt]).toEqual(["CONFLICT", null]);
    await registerMovement(almacen, { productId: p1, warehouseId: wh1, type: "IN", quantity: "5", reason: "compra" });
    await retrySyncConflict(admin, r.id);
    expect(await qty(wh1)).toBe("4");
  });

  it("dispositivo revocado: no se puede reintentar, solo rechazar", async () => {
    const quoteId = await acceptedQuote("50");
    const tmp = await mkDevice(seller.id);
    const [r] = await push(seller, tmp, [cmd("sale.convert", { quoteId, warehouseId: wh1 })]);
    expect(r.status).toBe("CONFLICT");
    await revokeDevice(admin, tmp.id);
    await expect(retrySyncConflict(admin, r.id, { warehouseId: wh2 })).rejects.toThrow(/revocado/);
    expect(await db.sale.count({ where: { quoteId } })).toBe(0);
    await rejectSyncConflict(admin, r.id);
    expect((await db.syncCommand.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("REJECTED");
  });
});

describe("cobranza e inventario", () => {
  it("pago mayor al saldo → REJECTED con mensaje claro", async () => {
    const sale = await db.sale.findFirstOrThrow({ where: { sellerId: seller.id } });
    const [r] = await push(manager, managerDevice, [cmd("payment.register", {
      id: randomUUID(), saleId: sale.id, amount: "999999", paidAt: new Date().toISOString(), method: "CASH",
    })]);
    expect(r.status).toBe("REJECTED");
    expect(r.error).toMatch(/rebasa el saldo pendiente/);
  });

  it("inventory.movement IN/OUT idempotente por id; OUT insuficiente → CONFLICT stock", async () => {
    const before = Number(await qty(wh2));
    const inId = randomUUID(), outId = randomUUID();
    const mv = (id: string, type: string, quantity: string) => cmd("inventory.movement", { id, productId: p1, warehouseId: wh2, type, quantity, reason: "conteo" });
    const res = await push(almacen, almacenDevice, [mv(inId, "IN", "4"), mv(inId, "IN", "4"), mv(outId, "OUT", "2"), mv(outId, "OUT", "2")]);
    expect(res.map((r) => r.status)).toEqual(["APPLIED", "APPLIED", "APPLIED", "APPLIED"]);
    expect(Number(await qty(wh2))).toBe(before + 2);
    const [big] = await push(almacen, almacenDevice, [mv(randomUUID(), "OUT", "1000")]);
    expect(big.status).toBe("CONFLICT");
    expect(big.result).toEqual({ kind: "stock", warehouseId: wh2, items: [{ productId: p1, sku: "P1", requested: "1000", available: String(before + 2) }] });
    const [denied] = await push(seller, device, [mv(randomUUID(), "IN", "1")]);
    expect(denied.status).toBe("REJECTED");
  });

  it("capturedAt en el futuro se ajusta a la hora del servidor y se audita la original", async () => {
    const future = new Date(Date.now() + 3 * 864e5);
    const c = cmd("inventory.movement", { id: randomUUID(), productId: p1, warehouseId: wh2, type: "IN", quantity: "1", reason: "reloj" }, future);
    const [r] = await push(almacen, almacenDevice, [c]);
    expect(r.status).toBe("APPLIED");
    const row = await db.syncCommand.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.capturedAt.getTime()).toBeLessThan(Date.now() + 60_000);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "sync.captured_at_clamped", entityId: c.id } });
    expect((log.data as { capturedAtClient: string }).capturedAtClient).toBe(future.toISOString());
  });
});
