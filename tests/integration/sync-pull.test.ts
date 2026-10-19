import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS, type RoleCode } from "@/lib/auth/permissions";
import { hashPassword } from "@/modules/users/service";
import { POST as register } from "@/app/api/sync/register/route";
import { POST as logout } from "@/app/api/sync/logout/route";
import { GET as pullRoute } from "@/app/api/sync/pull/route";
import { GET as bootstrap } from "@/app/api/sync/bootstrap/route";
import { POST as folios } from "@/app/api/sync/folios/route";
import { GET as version } from "@/app/api/app/version/route";

const tag = `sync-${Date.now()}`;
const PW = "Secreta-123";
const base = "http://localhost";

async function ensureRole(code: RoleCode) {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  for (const p of ROLE_PERMISSIONS[code]) {
    const perm = await db.permission.upsert({ where: { code: p }, create: { code: p }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
  }
  return role;
}

const req = (path: string, init: { method?: string; token?: string; body?: unknown; proto?: string } = {}) =>
  new Request(base + path, {
    method: init.method ?? "GET",
    headers: {
      "content-type": "application/json", "x-sync-protocol": init.proto ?? "1", "x-real-ip": `10.0.0.${tag.length}`,
      ...(init.token && { authorization: `Bearer ${init.token}` }),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

let sellerId = "", otherId = "", token = "", productId = "", customerId = "";

beforeAll(async () => {
  const ventas = await ensureRole("VENTAS");
  const passwordHash = await hashPassword(PW);
  sellerId = (await db.user.create({ data: { email: `${tag}-v@t.mx`, name: "Vendedor sync", passwordHash, roleId: ventas.id, mobileAccess: true } })).id;
  otherId = (await db.user.create({ data: { email: `${tag}-o@t.mx`, name: "Otro vendedor", passwordHash, roleId: ventas.id } })).id;
  productId = (await db.product.create({ data: { sku: `${tag}-P`, description: "Filtro sync", line: "VALVULAS_OTROS", price: 100, cost: 40 } })).id;
  customerId = (await db.customer.create({ data: { legalName: `${tag} Cliente`, ownerId: sellerId } })).id;
});

afterAll(async () => {
  await db.customer.deleteMany({ where: { legalName: { startsWith: tag } } });
  await db.product.deleteMany({ where: { sku: { startsWith: tag } } });
  await db.auditLog.deleteMany({ where: { userId: { in: [sellerId, otherId] } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

describe("sync: registro, bootstrap y pull", () => {
  it("rechaza usuario sin acceso móvil y protocolo viejo", async () => {
    const body = { email: `${tag}-o@t.mx`, password: PW, deviceName: "Moto", platform: "ANDROID", appVersion: "1.4.0" };
    const r = await register(req("/api/sync/register", { method: "POST", body }));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toMatch(/no tiene acceso a la app móvil/);
    const old = await register(req("/api/sync/register", { method: "POST", body, proto: "0" }));
    expect(old.status).toBe(409);
    expect((await old.json()).upgrade).toBe(true);
  });

  it("registra, descarga sin costos, recibe cambios y bajas", async () => {
    const r = await register(req("/api/sync/register", { method: "POST", body: { email: `${tag}-v@t.mx`, password: PW, deviceName: "Moto", platform: "ANDROID", appVersion: "1.4.0" } }));
    expect(r.status).toBe(200);
    const reg = await r.json();
    token = reg.token;
    expect(reg.user.role).toBe("VENTAS");
    expect(reg.user.permissions).toContain("quotes.write");
    expect(typeof reg.serverSeq).toBe("string");

    const b = await (await bootstrap(req("/api/sync/bootstrap?entity=Product&limit=1000", { token }))).json();
    expect(typeof b.serverSeq).toBe("string");
    expect(b.items.length).toBeGreaterThan(0);
    expect(b.items.every((p: Record<string, unknown>) => !("cost" in p) && !("markup" in p))).toBe(true);
    const cust = await (await bootstrap(req("/api/sync/bootstrap?entity=Customer", { token }))).json();
    expect(cust.items.map((c: { id: string }) => c.id)).toContain(customerId);

    await db.product.update({ where: { id: productId }, data: { price: 125.5 } });
    await db.customer.update({ where: { id: customerId }, data: { ownerId: otherId } });

    let cursor = b.serverSeq as string;
    const changes: { entity: string; id: string; deleted: boolean; data: Record<string, unknown> | null }[] = [];
    for (let i = 0; i < 20; i++) {
      const p = await (await pullRoute(req(`/api/sync/pull?cursor=${cursor}`, { token }))).json();
      changes.push(...p.changes);
      cursor = p.cursor;
      if (!p.hasMore) break;
    }
    const prod = changes.filter((c) => c.entity === "Product" && c.id === productId).at(-1)!;
    expect(prod.deleted).toBe(false);
    expect(prod.data!.price).toBe("125.5");
    expect(prod.data).not.toHaveProperty("cost");
    const c = changes.filter((x) => x.entity === "Customer" && x.id === customerId).at(-1)!;
    expect(c).toMatchObject({ deleted: true, data: null });
    const dev = await db.device.findFirstOrThrow({ where: { userId: sellerId } });
    expect(dev.lastPullSeq.toString()).toBe(cursor);
  });

  it("reserva folios, expone versión y cierra sesión", async () => {
    const f = await (await folios(req("/api/sync/folios", { method: "POST", token, body: { count: 3 } }))).json();
    expect(f.folios).toHaveLength(3);
    expect((await folios(req("/api/sync/folios", { method: "POST", token, body: { count: 26 } }))).status).toBe(400);
    const v = await (await version(new Request(base + "/api/app/version"))).json();
    expect(v.minimum).toBeTruthy();
    expect((await logout(req("/api/sync/logout", { method: "POST", token }))).status).toBe(200);
    expect((await pullRoute(req("/api/sync/pull?cursor=0", { token }))).status).toBe(401);
  });
});
