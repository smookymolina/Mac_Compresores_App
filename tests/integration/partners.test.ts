import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { createGuardrails, generateSync as gen } from "otplib";
const generateSync = (o: { secret: string; epoch?: number }) => gen({ ...o, guardrails: createGuardrails({ MIN_SECRET_BYTES: 10 }) });
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";

// ---- Mocks de Next (cookies/headers/redirect/cache) y del usuario interno ----
const jar = new Map<string, string>();
let reqIp = "10.0.0.1";
let adminUser: unknown;
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)! } : undefined),
    set: (n: string, v: string) => void jar.set(n, v),
    delete: (n: string | { name: string }) => void jar.delete(typeof n === "string" ? n : n.name),
  }),
  headers: async () => new Headers({ "x-forwarded-for": reqIp, "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${to};307;` });
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/session", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/session")>()), requirePermission: async () => adminUser }));

import { consumeBackupCode, generateBackupCodes, verifyPartnerPassword, verifyTotp } from "@/modules/partners/auth";
import { encryptSecret } from "@/modules/partners/crypto";
import { autoBlock, checkLimits, registerBurst } from "@/modules/partners/guard";
import { getPartnerPriceForProduct, searchPartnerProducts } from "@/modules/partners/search";
import { createPartnerSession, getCurrentPartner } from "@/modules/partners/session";
import { partnerLoginAction, partnerTotpSetupAction, partnerTotpVerifyAction, searchPricesAction } from "@/modules/partners/portal-actions";
import { resetPartner2faAction, savePartnerAction, setGlobalPartnerSettingsAction, setPartnerStatusAction } from "@/modules/partners/admin-actions";
import { listPartnerActivity, listPartners } from "@/modules/partners/queries";

const tag = `ptest${Date.now()}`;
const SECRET = "JBSWY3DPEHPK3PXP";
let n = 0;
const fd = (o: Record<string, string>) => Object.entries(o).reduce((f, [k, v]) => (f.append(k, v), f), new FormData());
const runId = Math.floor(Math.random() * 250);
const nextIp = () => (reqIp = `10.${runId}.${Math.floor(++n / 250)}.${n % 250}`);

async function mkPartner(over: Record<string, unknown> = {}) {
  return db.partner.create({
    data: {
      email: `${tag}-${++n}@t.mx`, name: "Socio Test", company: "Test SA", passwordHash: await bcrypt.hash("Pass-1234-xyz", 4),
      totpSecretEnc: encryptSecret(SECRET), totpEnabledAt: new Date(), ...over,
    },
  });
}
const redirected = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return String((e as { digest?: string }).digest).split(";")[2]; }
  return null;
};
let saved: { key: string; value: unknown }[] = [];

beforeAll(async () => {
  process.env.PARTNER_TOTP_KEY = randomBytes(32).toString("hex");
  process.env.PARTNER_TOKEN_SECRET = "test-secret-partners-0123456789";
  saved = (await db.setting.findMany({ where: { key: { startsWith: "partners." } } })).map((s) => ({ key: s.key, value: s.value }));
  const role = await db.role.upsert({ where: { code: "ADMIN" }, create: { code: "ADMIN", name: "ADMIN" }, update: {} });
  const u = await db.user.create({ data: { email: `${tag}-admin@t.mx`, name: "Admin T", passwordHash: "x", roleId: role.id } });
  adminUser = { id: u.id, name: u.name, email: u.email, role: "ADMIN", roleName: "ADMIN", permissions: new Set(ROLE_PERMISSIONS.ADMIN) };
  await db.setting.upsert({ where: { key: "partners.discountPct" }, create: { key: "partners.discountPct", value: 15 }, update: { value: 15 } });
  await db.setting.upsert({ where: { key: "partners.dailyQuota" }, create: { key: "partners.dailyQuota", value: 80 }, update: { value: 80 } });
});

afterAll(async () => {
  await db.auditLog.deleteMany({ where: { user: { email: { startsWith: tag } } } });
  await db.partner.deleteMany({ where: { email: { startsWith: tag } } });
  await db.product.deleteMany({ where: { sku: { startsWith: tag } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  for (const s of saved) await db.setting.update({ where: { key: s.key }, data: { value: s.value as never } });
  await db.$disconnect();
});

describe("TOTP", () => {
  it("acepta ±1 paso, rechaza el reuso y los pasos anteriores al último usado", async () => {
    const p = await mkPartner();
    const now = 1_900_000_000;
    const code = (t: number) => generateSync({ secret: SECRET, epoch: t });
    expect(await verifyTotp(p, code(now - 30), now)).toBe(true); // ventana -1
    const p2 = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect(p2.totpLastStep).toBe(Math.floor((now - 30) / 30));
    expect(await verifyTotp(p2, code(now - 30), now)).toBe(false); // reuso
    expect(await verifyTotp(p2, code(now), now)).toBe(true); // paso posterior
    const p3 = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect(await verifyTotp(p3, code(now), now)).toBe(false);
    expect(await verifyTotp(p3, code(now - 30), now)).toBe(false); // anterior al último
    const q = await mkPartner();
    expect(await verifyTotp(q, code(now - 90), now)).toBe(false); // fuera de ventana
    expect(await verifyTotp(q, "12345", now)).toBe(false);
  });
  it("dos peticiones simultáneas con el mismo código: solo una pasa", async () => {
    const p = await mkPartner();
    const now = Math.floor(Date.now() / 1000);
    const c = generateSync({ secret: SECRET, epoch: now });
    const r = await Promise.all([verifyTotp(p, c, now), verifyTotp(p, c, now)]);
    expect(r.filter(Boolean)).toHaveLength(1);
  });
  it("códigos de respaldo: 10, un solo uso", async () => {
    const { plain, hashes } = await generateBackupCodes();
    expect(plain).toHaveLength(10);
    const p = await mkPartner({ backupCodes: hashes });
    expect(await consumeBackupCode(p, plain[3]!.toUpperCase())).toBe(true);
    const p2 = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect(p2.backupCodes).toHaveLength(9);
    expect(await consumeBackupCode(p, plain[3]!)).toBe(false);
    expect(await consumeBackupCode(p2, plain[3]!)).toBe(false);
    expect(await consumeBackupCode(p2, "zzzzz-zzzzz")).toBe(false);
  });
  it("dos códigos de respaldo distintos a la vez: se consumen los dos (sin lost update)", async () => {
    const { plain, hashes } = await generateBackupCodes();
    const p = await mkPartner({ backupCodes: hashes });
    expect(await Promise.all([consumeBackupCode(p, plain[0]!), consumeBackupCode(p, plain[1]!)])).toEqual([true, true]);
    expect((await db.partner.findUniqueOrThrow({ where: { id: p.id } })).backupCodes).toHaveLength(8);
    expect(await consumeBackupCode(p, plain[0]!)).toBe(false);
  });
});

describe("contraseña y bloqueo", () => {
  it("5 fallos bloquean la cuenta, revocan sesiones y registran; después ni la contraseña correcta entra", async () => {
    const p = await mkPartner();
    await db.partnerSession.create({ data: { id: `s-${tag}-1`, partnerId: p.id, expiresAt: new Date(Date.now() + 1e6) } });
    for (let i = 0; i < 4; i++) await expect(verifyPartnerPassword(p.email, "mala")).rejects.toThrow(/inválidos/);
    expect((await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ACTIVE");
    await expect(verifyPartnerPassword(p.email, "mala")).rejects.toThrow(/bloqueada/);
    const after = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect(after.status).toBe("BLOCKED");
    expect(after.blockedReason).toBeTruthy();
    expect(await db.partnerSession.count({ where: { partnerId: p.id } })).toBe(0);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "AUTO_BLOCK" } })).toBe(1);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "LOGIN_FAIL" } })).toBe(5);
    await expect(verifyPartnerPassword(p.email, "Pass-1234-xyz")).rejects.toThrow(/Demasiados|bloqueada/);
  });
  it("autoBlock es idempotente (un solo AUTO_BLOCK)", async () => {
    const p = await mkPartner();
    await autoBlock(p.id, "honeypot", { path: "/socios/api-precios" });
    await autoBlock(p.id, "honeypot");
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "AUTO_BLOCK" } })).toBe(1);
  });
  it("20 contraseñas en paralelo: solo 5 se evalúan y la correcta no se confirma", async () => {
    const p = await mkPartner();
    const tries = Array.from({ length: 20 }, (_, i) => (i === 19 ? "Pass-1234-xyz" : `mala-${i}`));
    const res = await Promise.allSettled(tries.map((pw) => verifyPartnerPassword(p.email, pw)));
    const evaluated = res.filter((r) => r.status === "fulfilled" || !/Demasiados/.test(String(r.reason)));
    expect(evaluated.length).toBeLessThanOrEqual(5);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "LOGIN_FAIL" } })).toBeLessThanOrEqual(5);
  });
  it("correo desconocido: mismo mensaje genérico", async () => {
    await expect(verifyPartnerPassword(`${tag}-nadie@t.mx`, "x")).rejects.toThrow("Correo o contraseña inválidos.");
  });
});

describe("límites y cuota", () => {
  it("cuota diaria: cuenta regresiva, error amable, y bloqueo si insiste", async () => {
    const p = await mkPartner({ dailyQuota: 3 });
    const ip = nextIp();
    expect((await checkLimits(p, ip)).remaining).toBe(2);
    expect((await checkLimits(p, ip)).remaining).toBe(1);
    expect((await checkLimits(p, ip)).remaining).toBe(0);
    await expect(checkLimits(p, ip)).rejects.toThrow(/límite de consultas de hoy/);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "QUOTA_EXCEEDED" } })).toBe(1);
    for (let i = 0; i < 3; i++) await expect(checkLimits(p, ip)).rejects.toThrow(/límite/);
    await expect(checkLimits(p, ip)).rejects.toThrow(/bloqueado/);
    expect((await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("BLOCKED");
  });
  it("usa la cuota global cuando el socio no tiene propia", async () => {
    await db.setting.update({ where: { key: "partners.dailyQuota" }, data: { value: 5 } });
    const p = await mkPartner();
    expect((await checkLimits(p, nextIp())).remaining).toBe(4);
    await db.setting.update({ where: { key: "partners.dailyQuota" }, data: { value: 80 } });
  });
  it("máximo 10 por minuto y más de 3 ráfagas bloquean", async () => {
    const p = await mkPartner({ dailyQuota: 1000 });
    const ip = nextIp();
    for (let i = 0; i < 10; i++) await checkLimits(p, ip);
    await expect(checkLimits(p, ip)).rejects.toThrow(/muy rápido/); // ráfaga 1
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "RATE_LIMITED" } })).toBe(1);
    await registerBurst(p.id, "barrido"); // 2
    await registerBurst(p.id, "barrido"); // 3
    expect((await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ACTIVE");
    await registerBurst(p.id, "barrido"); // 4 → bloquea
    expect((await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("BLOCKED");
  });
  it("30 por minuto por IP", async () => {
    const ip = nextIp();
    const ps = await Promise.all([mkPartner({ dailyQuota: 1000 }), mkPartner({ dailyQuota: 1000 }), mkPartner({ dailyQuota: 1000 }), mkPartner({ dailyQuota: 1000 })]);
    for (let i = 0; i < 30; i++) await checkLimits(ps[i % 4]!, ip).catch(() => {});
    await expect(checkLimits(ps[0]!, ip)).rejects.toThrow(/tu conexión/);
  });
});

describe("búsqueda y precios (sin fuga de costo ni de precio)", () => {
  let partner: Awaited<ReturnType<typeof mkPartner>>;
  beforeAll(async () => {
    const mk = (suffix: string, extra: Record<string, unknown>) =>
      db.product.create({ data: { sku: `${tag}-${suffix}`, description: `Filtroprueba ${suffix}`, line: "VALVULAS_OTROS", cost: "5555.55", price: "7391.37", ...extra } });
    await mk("MXN", {});
    await mk("USD", { currency: "USD", price: "48.20" });
    await mk("CERO", { price: "0" });
    await mk("BAJA", { status: "INACTIVE" });
    partner = await mkPartner({ dailyQuota: 1000 });
  });
  it("searchPartnerProducts: activos con precio > 0, sin costo", async () => {
    const rows = await searchPartnerProducts("FILTROPRUEBA");
    expect(rows.map((r) => r.sku).sort()).toEqual([`${tag}-MXN`, `${tag}-USD`]);
    expect(Object.keys(rows[0]!).sort()).toEqual(["currency", "description", "id", "price", "sku", "unit"]);
    expect(JSON.stringify(rows)).not.toMatch(/cost|5555/i);
    expect(await searchPartnerProducts("fi")).toEqual([]);
    expect(await searchPartnerProducts("%%%")).toEqual([]);
  });
  it("getPartnerPriceForProduct: global 15%, override, MXN y USD", async () => {
    const [mxn, usd] = await Promise.all(["MXN", "USD"].map((s) => db.product.findUniqueOrThrow({ where: { sku: `${tag}-${s}` } })));
    const r1 = await getPartnerPriceForProduct(mxn!.id, partner);
    expect(r1!.price.toFixed(2)).toBe("6282.66");
    expect(r1!.currency).toBe("MXN");
    const r2 = await getPartnerPriceForProduct(usd!.id, { discountPct: new (await import("@/lib/money")).D("10") });
    expect(r2!.price.toFixed(2)).toBe("43.38");
    expect(r2!.currency).toBe("USD");
    const zero = await db.product.findUniqueOrThrow({ where: { sku: `${tag}-CERO` } });
    expect(await getPartnerPriceForProduct(zero.id, partner)).toBeNull();
  });
  it("flujo completo: login → alta 2FA → sesión → searchPricesAction sin precio ni costo", async () => {
    nextIp();
    const p = await mkPartner({ totpSecretEnc: null, totpEnabledAt: null, dailyQuota: 50 });
    expect(await redirected(partnerLoginAction(null, fd({ email: p.email, password: "mala" })))).toBeNull();
    expect(await redirected(partnerLoginAction(null, fd({ email: p.email, password: "Pass-1234-xyz" })))).toBe("/socios/2fa");
    const setup = await partnerTotpSetupAction();
    expect(setup.ok && setup.data!.qr.startsWith("data:image/png;base64,")).toBe(true);
    if (!setup.ok) throw new Error("setup");
    expect(setup.data!.backupCodes).toHaveLength(10);
    expect((await partnerTotpVerifyAction(null, fd({ code: "000000" }))).ok).toBe(false);
    const code = generateSync({ secret: setup.data!.secret });
    expect(await redirected(partnerTotpVerifyAction(null, fd({ code })))).toBe("/socios");
    const cur = await getCurrentPartner();
    expect(cur?.partner.id).toBe(p.id);
    expect(JSON.stringify(cur)).not.toMatch(/passwordHash|totpSecret|backupCodes/);

    const res = await searchPricesAction("Filtroprueba");
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("search");
    const json = JSON.stringify(res);
    expect(res.data!.items.map((i) => i.sku).sort()).toEqual([`${tag}-MXN`, `${tag}-USD`]);
    expect(res.data!.remaining).toBe(49);
    expect(res.data!.items[0]!.img).toMatch(/^\/socios\/p\/.+\..+$/);
    for (const bad of [/cost/i, /price/i, /5555/, /7391/, /6282/, /48\.2/, /40\.97/]) expect(json).not.toMatch(bad);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "SEARCH" } })).toBe(1);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: { in: ["LOGIN_OK", "TOTP_OK", "TOTP_SETUP", "TOTP_FAIL"] } } })).toBe(4);

    expect((await searchPricesAction("ab")).ok).toBe(false);
    // Una nueva sesión revoca la anterior.
    const first = jar.get("__Secure-mac_partner");
    await createPartnerSession(p.id);
    expect(jar.get("__Secure-mac_partner")).not.toBe(first);
    expect(await db.partnerSession.count({ where: { partnerId: p.id } })).toBe(1);
  });
  it("sesión: vence por inactividad (30 min) y absoluta (8 h)", async () => {
    const p = await mkPartner();
    await createPartnerSession(p.id);
    expect(await getCurrentPartner()).not.toBeNull();
    await db.partnerSession.updateMany({ where: { partnerId: p.id }, data: { lastActivityAt: new Date(Date.now() - 31 * 60_000) } });
    expect(await getCurrentPartner()).toBeNull();
    await createPartnerSession(p.id);
    await db.partnerSession.updateMany({ where: { partnerId: p.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentPartner()).toBeNull();
    await createPartnerSession(p.id);
    await db.partner.update({ where: { id: p.id }, data: { status: "BLOCKED" } });
    expect(await getCurrentPartner()).toBeNull();
  });
  it("barrido: la acción lo registra y cuenta como ráfaga", async () => {
    const p = await mkPartner({ dailyQuota: 100 });
    await createPartnerSession(p.id);
    nextIp();
    for (const t of ["zaa", "zab", "zac", "zad"]) await searchPricesAction(t);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "SWEEP_SUSPECT" } })).toBe(1);
  });
});

describe("administración", () => {
  it("crear socio devuelve contraseña temporal una sola vez y solo guarda su hash", async () => {
    const r = await savePartnerAction(null, fd({ name: "Ana Socia", company: "Ana SA", email: `${tag}-NEW@T.mx`, discountPct: "12.5", dailyQuota: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error();
    const pw = r.data!.tempPassword!;
    expect(pw.length).toBeGreaterThanOrEqual(12);
    const row = await db.partner.findUniqueOrThrow({ where: { id: r.data!.id } });
    expect(row.email).toBe(`${tag}-new@t.mx`);
    expect(row.passwordHash).not.toContain(pw);
    expect(await bcrypt.compare(pw, row.passwordHash)).toBe(true);
    expect(row.discountPct?.toString()).toBe("12.5");
    expect(row.dailyQuota).toBeNull();
    expect(await db.partnerActivity.count({ where: { partnerId: row.id, type: "ADMIN_CHANGE" } })).toBe(1);
    expect(await db.auditLog.count({ where: { entity: "Partner", entityId: row.id, action: "partner.create" } })).toBe(1);
    // editar no genera contraseña
    const e = await savePartnerAction(null, fd({ id: row.id, name: "Ana S.", company: "Ana SA", email: row.email, discountPct: "", dailyQuota: "30" }));
    expect(e.ok && e.data!.tempPassword).toBeFalsy();
    expect((await db.partner.findUniqueOrThrow({ where: { id: row.id } })).discountPct).toBeNull();
    // validaciones
    expect((await savePartnerAction(null, fd({ name: "X", company: "Y", email: "mal", discountPct: "61" }))).ok).toBe(false);
    expect((await savePartnerAction(null, fd({ name: "Ana", company: "Ana SA", email: `${tag}-z@t.mx`, dailyQuota: "1001" }))).ok).toBe(false);
  });
  it("ajustes globales validan rangos; bloquear/desbloquear y reset 2FA", async () => {
    expect((await setGlobalPartnerSettingsAction(null, fd({ discountPct: "60.01", dailyQuota: "80" }))).ok).toBe(false);
    expect((await setGlobalPartnerSettingsAction(null, fd({ discountPct: "10.123", dailyQuota: "80" }))).ok).toBe(false);
    expect((await setGlobalPartnerSettingsAction(null, fd({ discountPct: "10", dailyQuota: "0" }))).ok).toBe(false);
    expect((await setGlobalPartnerSettingsAction(null, fd({ discountPct: "10.5", dailyQuota: "1000" }))).ok).toBe(true);
    expect((await db.setting.findUniqueOrThrow({ where: { key: "partners.discountPct" } })).value).toBe(10.5);
    await setGlobalPartnerSettingsAction(null, fd({ discountPct: "15", dailyQuota: "80" }));

    const p = await mkPartner({ failedLogins: 5, status: "BLOCKED", blockedReason: "x", blockedAt: new Date() });
    expect((await setPartnerStatusAction({ id: p.id, status: "ACTIVE" })).ok).toBe(true);
    const a = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect([a.status, a.failedLogins, a.blockedReason]).toEqual(["ACTIVE", 0, null]);
    await db.partnerSession.create({ data: { id: `s-${tag}-2`, partnerId: p.id, expiresAt: new Date(Date.now() + 1e6) } });
    expect((await setPartnerStatusAction({ id: p.id, status: "BLOCKED", reason: "manual" })).ok).toBe(true);
    expect(await db.partnerSession.count({ where: { partnerId: p.id } })).toBe(0);
    expect((await resetPartner2faAction({ id: p.id })).ok).toBe(true);
    const b = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect([b.totpSecretEnc, b.totpEnabledAt, b.backupCodes.length]).toEqual([null, null, 0]);
    expect((await setPartnerStatusAction({ id: "no-uuid", status: "ACTIVE" })).ok).toBe(false);
  });
  it("consultas: listados sin secretos y actividad filtrada", async () => {
    const list = await listPartners({ search: tag });
    expect(list.items.length).toBeGreaterThan(3);
    expect(JSON.stringify(list)).not.toMatch(/passwordHash|totpSecretEnc|backupCodes/);
    const p = list.items[0]!;
    const act = await listPartnerActivity({ partnerId: p.id, page: 1 });
    expect(act.items.every((i) => i.partnerId === p.id)).toBe(true);
    const today = new Date().toISOString().slice(0, 10);
    const f = await listPartnerActivity({ type: "AUTO_BLOCK", from: today, to: today });
    expect(f.items.length).toBeGreaterThan(0);
    expect(f.items.every((i) => i.type === "AUTO_BLOCK")).toBe(true);
    expect((await listPartnerActivity({ from: "2001-01-01", to: "2001-01-02" })).total).toBe(0);
  });
});
