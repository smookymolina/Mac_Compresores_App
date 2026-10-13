// QA v1.4.0 (Agente 9): el monto que realmente se dibuja en el PNG del precio (espía de renderPriceImage)
// ante descuento global 15% → 20%, override por socio, MXN y USD (TUBERIA). Sin tocar la app.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const jar = new Map<string, string>();
let adminUser: unknown;
const render = vi.hoisted(() => vi.fn(async (_o: { amount: string; currency: string; watermark: string }) => Buffer.from([0x89, 0x50])));
vi.mock("@/lib/price-image", () => ({ renderPriceImage: render }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string | { name: string }) => void jar.delete(typeof n === "string" ? n : n.name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` }); } }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/session")>()), requirePermission: async () => adminUser }));

import { encryptSecret } from "@/modules/partners/crypto";
import { createPartnerSession } from "@/modules/partners/session";
import { searchPricesAction } from "@/modules/partners/portal-actions";
import { savePartnerAction, setGlobalPartnerSettingsAction } from "@/modules/partners/admin-actions";
import { GET } from "@/app/(socios)/socios/p/[token]/route";

const tag = `pqa${Date.now()}`;
let n = 0;
const fd = (o: Record<string, string>) => Object.entries(o).reduce((f, [k, v]) => (f.append(k, v), f), new FormData());
let saved: { key: string; value: unknown }[] = [];

async function mkPartner(over: Record<string, unknown> = {}) {
  return db.partner.create({
    data: {
      email: `${tag}-${++n}@t.mx`, name: `Socio QA ${n}`, company: "QA SA", passwordHash: await bcrypt.hash("x", 4),
      totpSecretEnc: encryptSecret("JBSWY3DPEHPK3PXP"), totpEnabledAt: new Date(), dailyQuota: 1000, ...over,
    },
  });
}

/** Busca como el socio y pide cada PNG; devuelve {sku: "monto moneda"} tal como se dibujaría. */
async function drawn(partnerId: string): Promise<Record<string, string>> {
  await createPartnerSession(partnerId);
  const r = await searchPricesAction(tag);
  if (!r.ok) throw new Error(r.error);
  const out: Record<string, string> = {};
  for (const it of r.data!.items) {
    render.mockClear();
    const token = it.img.split("/").pop()!;
    const res = await GET(new Request(`http://localhost${it.img}`), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    const call = render.mock.calls[0]![0];
    expect(call.watermark.startsWith(`${partnerId}|`)).toBe(true);
    out[it.sku.replace(`${tag}-`, "")] = `${call.amount} ${call.currency}`;
  }
  return out;
}

beforeAll(async () => {
  process.env.PARTNER_TOTP_KEY = randomBytes(32).toString("hex");
  process.env.PARTNER_TOKEN_SECRET = "test-secret-partners-qa-0123456789";
  saved = (await db.setting.findMany({ where: { key: { startsWith: "partners." } } })).map((s) => ({ key: s.key, value: s.value }));
  const role = await db.role.upsert({ where: { code: "ADMIN" }, create: { code: "ADMIN", name: "ADMIN" }, update: {} });
  const u = await db.user.create({ data: { email: `${tag}-admin@t.mx`, name: "Admin QA", passwordHash: "x", roleId: role.id } });
  adminUser = { id: u.id, name: u.name, email: u.email, role: "ADMIN", roleName: "ADMIN", permissions: new Set(ROLE_PERMISSIONS.ADMIN) };
  await db.setting.upsert({ where: { key: "partners.discountPct" }, create: { key: "partners.discountPct", value: 15 }, update: { value: 15 } });
  await db.setting.upsert({ where: { key: "partners.dailyQuota" }, create: { key: "partners.dailyQuota", value: 80 }, update: { value: 80 } });
  await db.product.create({ data: { sku: `${tag}-MXN`, description: `Pieza ${tag}`, line: "REFACCIONES", cost: "5555.55", price: "7391.37" } });
  await db.product.create({ data: { sku: `${tag}-TUB`, description: `Tubo ${tag}`, line: "TUBERIA", currency: "USD", cost: "30", price: "48.20" } });
  await db.product.create({ data: { sku: `${tag}-HALF`, description: `Medio ${tag}`, line: "REFACCIONES", cost: "1", price: "10.05" } });
});

afterAll(async () => {
  for (const s of saved) await db.setting.update({ where: { key: s.key }, data: { value: s.value as never } });
  await db.auditLog.deleteMany({ where: { user: { email: { startsWith: tag } } } });
  await db.partner.deleteMany({ where: { email: { startsWith: tag } } });
  await db.product.deleteMany({ where: { sku: { startsWith: tag } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

describe("monto dibujado en el PNG del precio", () => {
  it("global 15% → 20% (siguiente búsqueda), override por socio gana, MXN y USD, half-up", async () => {
    const g = await mkPartner();
    expect(await drawn(g.id)).toEqual({ MXN: "6282.66 MXN", TUB: "40.97 USD", HALF: "8.54 MXN" }); // 10.05×0.85=8.5425

    expect((await setGlobalPartnerSettingsAction(null, fd({ discountPct: "20", dailyQuota: "80" }))).ok).toBe(true);
    expect(await drawn(g.id)).toEqual({ MXN: "5913.10 MXN", TUB: "38.56 USD", HALF: "8.04 MXN" }); // 5913.096 → 5913.10

    const o = await mkPartner({ discountPct: "10" });
    expect(await drawn(o.id)).toEqual({ MXN: "6652.23 MXN", TUB: "43.38 USD", HALF: "9.05 MXN" }); // 9.045 → 9.05 half-up

    // Override vía la acción de administración; 50% exacto prueba el medio centavo (10.05×0.5=5.025 → 5.03).
    const e = await savePartnerAction(null, fd({ id: o.id, name: o.name, company: o.company, email: o.email, discountPct: "50", dailyQuota: "1000" }));
    expect(e.ok).toBe(true);
    expect(await drawn(o.id)).toEqual({ MXN: "3695.69 MXN", TUB: "24.10 USD", HALF: "5.03 MXN" }); // 3695.685 → 3695.69

    // 0% propio: precio de lista aunque el global sea 20%.
    await savePartnerAction(null, fd({ id: o.id, name: o.name, company: o.company, email: o.email, discountPct: "0", dailyQuota: "1000" }));
    expect(await drawn(o.id)).toEqual({ MXN: "7391.37 MXN", TUB: "48.20 USD", HALF: "10.05 MXN" });
  });

  it("el token de otro socio o de otra sesión no dibuja nada (404)", async () => {
    const a = await mkPartner();
    const b = await mkPartner();
    await createPartnerSession(a.id);
    const r = await searchPricesAction(tag);
    if (!r.ok) throw new Error(r.error);
    const img = r.data!.items[0]!.img;
    const token = img.split("/").pop()!;
    await createPartnerSession(b.id); // cambia la cookie: ahora es b
    render.mockClear();
    const res = await GET(new Request(`http://localhost${img}`), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(404);
    expect(render).not.toHaveBeenCalled();
    await createPartnerSession(a.id); // nueva sesión de a: el token de la sesión anterior ya no sirve
    expect((await GET(new Request(`http://localhost${img}`), { params: Promise.resolve({ token }) })).status).toBe(404);
  });

  it("historial: el cambio de descuento global queda en AuditLog (no en PartnerActivity)", async () => {
    const before = await db.partnerActivity.count({ where: { type: "ADMIN_CHANGE", createdAt: { gte: new Date(Date.now() - 5000) } } });
    await setGlobalPartnerSettingsAction(null, fd({ discountPct: "17", dailyQuota: "80" }));
    expect(await db.auditLog.count({ where: { action: "partner.settings", user: { email: { startsWith: tag } } } })).toBeGreaterThan(0);
    const after = await db.partnerActivity.count({ where: { type: "ADMIN_CHANGE", createdAt: { gte: new Date(Date.now() - 5000) } } });
    expect(after).toBe(before); // BUG-QA-02: /socios-admin/historial (PartnerActivity) no muestra el cambio global
  });
});
