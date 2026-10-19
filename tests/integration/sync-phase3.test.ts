import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Device } from "@prisma/client";

const sent: { to: string[]; subject: string }[] = [];
vi.mock("@/lib/mail", async (orig) => ({
  ...(await orig<typeof import("@/lib/mail")>()),
  isMailConfigured: () => true,
  sendMail: async (m: { to: string[]; subject: string }) => void sent.push(m),
}));
vi.mock("@/modules/quotes/pdf", async (orig) => ({
  ...(await orig<typeof import("@/modules/quotes/pdf")>()),
  renderQuotePdf: async () => new Uint8Array([37, 80, 68, 70]),
}));

import { db } from "@/lib/db";
import { hashToken, type CurrentUser } from "@/lib/auth/session";
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type RoleCode } from "@/lib/auth/permissions";
import { newDeviceToken } from "@/modules/sync/device";
import { push } from "@/modules/sync/push";
import { resolvePriceConflict } from "@/modules/sync/admin";
import type { PriceConflictResult } from "@/modules/sync/protocol";
import { GET as configRoute } from "@/app/api/sync/config/route";
import { GET as commandsRoute } from "@/app/api/sync/commands/route";

const DAY = 864e5;
const ago = (days: number) => new Date(Date.now() - days * DAY);
let seller: CurrentUser, admin: CurrentUser, noOverride: CurrentUser;
let device: Device, otherDevice: Device, token: string;
let customerId: string, p1: string, u1: string;

async function mkUser(code: RoleCode, email: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  for (const c of ROLE_PERMISSIONS[code]) {
    const p = await db.permission.upsert({ where: { code: c }, create: { code: c }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } }, create: { roleId: role.id, permissionId: p.id }, update: {} });
  }
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id, mobileAccess: true } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

const quoteCmd = (capturedAt: Date, items: Record<string, unknown>[], extra: Record<string, unknown> = {}) => ({
  id: randomUUID(), type: "quote.create", capturedAt: capturedAt.toISOString(),
  payload: { id: randomUUID(), customerId, validUntil: new Date(Date.now() + 7 * DAY).toISOString(), currency: "MXN", items, ...extra },
});
const item = (productId: string, clientListPrice?: string) => ({ productId, quantity: "1", discountPct: "0", ...(clientListPrice && { clientListPrice }) });
const unitPrices = async (quoteId: string) =>
  (await db.quoteItem.findMany({ where: { quoteId }, orderBy: { position: "asc" } })).map((i) => i.unitPrice.toString());
const req = (url: string, t = token) => new Request(url, { headers: { "x-sync-protocol": "1", authorization: `Bearer ${t}` } });

beforeAll(async () => {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(",")} CASCADE`);
  seller = await mkUser("VENTAS", "s@t");
  admin = { ...(await mkUser("ADMIN", "a@t")), permissions: new Set<Permission>(PERMISSIONS) };
  noOverride = { ...admin, permissions: new Set<Permission>(["users.manage"]) };
  token = newDeviceToken();
  device = await db.device.create({ data: { userId: seller.id, name: "Tel", platform: "ANDROID", appVersion: "1.4.0", tokenHash: hashToken(token) } });
  otherDevice = await db.device.create({ data: { userId: seller.id, name: "Tel2", platform: "ANDROID", appVersion: "1.4.0", tokenHash: hashToken(newDeviceToken()) } });
  customerId = (await db.customer.create({ data: { legalName: "Cliente", ownerId: seller.id } })).id;
  p1 = (await db.product.create({ data: { sku: "P1", description: "Pieza", line: "REFACCIONES", cost: 500, price: 1000 } })).id;
  u1 = (await db.product.create({ data: { sku: "U1", description: "Tubo", line: "REFACCIONES", cost: 50, price: 100, currency: "USD" } })).id;
  await db.priceHistory.createMany({ data: [
    { productId: p1, cost: 500, price: 900, createdAt: ago(2) },
    { productId: p1, cost: 500, price: 1000, createdAt: ago(0.01) },
    { productId: u1, cost: 50, price: 100, createdAt: ago(2) },
  ] });
  await db.exchangeRate.createMany({ data: [{ rate: 17, createdAt: ago(2) }, { rate: 18, createdAt: ago(0.01) }] });
});

afterAll(() => db.$disconnect());

describe("ventana de gracia de precios (§5.3)", () => {
  it("precio de catálogo anterior dentro de la ventana → se respeta y se audita", async () => {
    const c = quoteCmd(ago(1), [item(p1, "900"), item(p1, "1000")]);
    const [r] = await push(seller, device, [c]);
    expect(r.status).toBe("APPLIED");
    const id = (r.result as { id: string }).id;
    expect(await unitPrices(id)).toEqual(["900", "1000"]);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "quote.price_grace", entityId: id } });
    expect((log.data as { items: unknown[] }).items).toEqual([{ productId: p1, sku: "P1", clientPrice: "900", serverPrice: "1000" }]);
  });

  it("fuera de la ventana → CONFLICT con el detalle de precios y sin cotización", async () => {
    const c = quoteCmd(ago(5), [item(p1, "900")]);
    const [r] = await push(seller, device, [c]);
    expect(r.status).toBe("CONFLICT");
    expect(r.result).toEqual({ kind: "price", items: [{ productId: p1, sku: "P1", clientPrice: "900", serverPrice: "1000" }] });
    expect(await db.quote.count({ where: { id: c.payload.id } })).toBe(0);
  });

  it("precio que nunca existió → CONFLICT", async () => {
    const [r] = await push(seller, device, [quoteCmd(ago(1), [item(p1, "950")])]);
    expect(r.status).toBe("CONFLICT");
  });

  it("USD: TC anterior vigente en la captura se respeta; TC inventado o fuera de ventana → CONFLICT", async () => {
    const [ok] = await push(seller, device, [quoteCmd(ago(1), [item(u1, "1700")], { clientExchangeRate: "17" })]);
    expect(ok.status).toBe("APPLIED");
    const id = (ok.result as { id: string }).id;
    expect(await unitPrices(id)).toEqual(["1700"]);
    expect((await db.quote.findUniqueOrThrow({ where: { id } })).exchangeRate?.toString()).toBe("17");

    const [bad] = await push(seller, device, [quoteCmd(ago(1), [item(u1, "1650")], { clientExchangeRate: "16.5" })]);
    expect(bad.status).toBe("CONFLICT");
    expect((bad.result as PriceConflictResult).exchangeRate).toEqual({ client: "16.5", server: "18" });

    const [old] = await push(seller, device, [quoteCmd(ago(5), [item(u1, "1700")], { clientExchangeRate: "17" })]);
    expect(old.status).toBe("CONFLICT");
    expect((old.result as PriceConflictResult).items[0]).toMatchObject({ sku: "U1", clientPrice: "1700", serverPrice: "1800" });
  });

  it("sin clientListPrice (cliente viejo) o precio vigente → se aplica normal", async () => {
    const [r] = await push(seller, device, [quoteCmd(ago(10), [item(p1), item(p1, "1000")])]);
    expect(r.status).toBe("APPLIED");
  });
});

describe("resolución de conflictos de precio", () => {
  const conflict = async () => {
    const c = quoteCmd(ago(5), [item(p1, "950")]);
    const [r] = await push(seller, device, [c]);
    expect(r.status).toBe("CONFLICT");
    return c;
  };

  it("server → APPLIED con precios vigentes y aviso al vendedor", async () => {
    const c = await conflict();
    const out = await resolvePriceConflict(admin, c.id, "server");
    expect(out.status).toBe("APPLIED");
    const cmd = await db.syncCommand.findUniqueOrThrow({ where: { id: c.id } });
    expect(cmd.status).toBe("APPLIED");
    expect(cmd.resolvedById).toBe(admin.id);
    expect(await unitPrices(c.payload.id)).toEqual(["1000"]);
    expect(await db.notification.count({ where: { userId: seller.id, kind: "sync.price_conflict" } })).toBeGreaterThan(0);
    await expect(resolvePriceConflict(admin, c.id, "reject")).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("client requiere quotes.override_price y aplica el precio del teléfono", async () => {
    const c = await conflict();
    await expect(resolvePriceConflict(noOverride, c.id, "client")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await resolvePriceConflict(admin, c.id, "client");
    expect(await unitPrices(c.payload.id)).toEqual(["950"]);
    expect((await db.quote.findUniqueOrThrow({ where: { id: c.payload.id } })).sellerId).toBe(seller.id);
  });

  it("reject → REJECTED sin cotización", async () => {
    const c = await conflict();
    await resolvePriceConflict(admin, c.id, "reject");
    expect((await db.syncCommand.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("REJECTED");
    expect(await db.quote.count({ where: { id: c.payload.id } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: "sync.price_conflict_resolved", entityId: c.id } })).toBe(1);
  });
});

describe("quote.email, /config y /commands", () => {
  it("quote.email envía el correo y pasa el borrador a enviada", async () => {
    const [q] = await push(seller, device, [quoteCmd(new Date(), [item(p1)])]);
    const quoteId = (q.result as { id: string }).id;
    const [r, bad] = await push(seller, device, [
      { id: randomUUID(), type: "quote.email", capturedAt: new Date().toISOString(), payload: { quoteId, to: ["c@x.mx"], message: "Hola" } },
      { id: randomUUID(), type: "quote.email", capturedAt: new Date().toISOString(), payload: { quoteId, to: ["nope"], message: "" } },
    ]);
    expect(r.status).toBe("APPLIED");
    expect(bad.status).toBe("REJECTED");
    expect(sent.at(-1)?.to).toEqual(["c@x.mx"]);
    expect((await db.quote.findUniqueOrThrow({ where: { id: quoteId } })).status).toBe("SENT");
    expect(await db.auditLog.count({ where: { action: "quote.email", entityId: quoteId } })).toBe(1);
  });

  it("/config devuelve datos del usuario del dispositivo y parámetros", async () => {
    process.env.BANK_INFO = "Banco X | CLABE 123";
    await db.user.update({ where: { id: seller.id }, data: { quoteBlock: Buffer.from([1, 2, 3]) } });
    await db.setting.create({ data: { key: "sync.maxOfflineDays", value: 10 } });
    const res = await configRoute(req("http://localhost/api/sync/config"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      bankInfo: "Banco X\nCLABE 123", sellerBlockPng: Buffer.from([1, 2, 3]).toString("base64"),
      maxDiscountPct: "0.15", canOverridePrice: false, priceGraceDays: 3, maxOfflineDays: 10,
    });
    expect((await configRoute(req("http://localhost/api/sync/config", "bad"))).status).toBe(401);
  });

  it("/commands solo devuelve comandos de este dispositivo", async () => {
    const mine = quoteCmd(new Date(), [item(p1)]);
    const theirs = quoteCmd(new Date(), [item(p1)]);
    await push(seller, device, [mine]);
    await push(seller, otherDevice, [theirs]);
    const res = await commandsRoute(req(`http://localhost/api/sync/commands?ids=${mine.id},${theirs.id}`));
    const body = (await res.json()) as { id: string; status: string }[];
    expect(body.map((b) => [b.id, b.status])).toEqual([[mine.id, "APPLIED"]]);
    const many = Array.from({ length: 101 }, () => randomUUID()).join(",");
    expect((await commandsRoute(req(`http://localhost/api/sync/commands?ids=${many}`))).status).toBe(400);
  });
});
