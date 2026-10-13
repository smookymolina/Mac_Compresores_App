// Utilidades E2E del portal de socios (@socios). Escriben directo en la BD temporal (DATABASE_URL) para que
// cada prueba use socios propios y no se contaminen entre sí ni con el socio demo.
import { createCipheriv, randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { createGuardrails, generateSync } from "otplib";
import { expect, type Page } from "@playwright/test";

export const db = new PrismaClient();
export const SECRET = "JBSWY3DPEHPK3PXP";
export const PASS = "Qa-Socio-2026!x";
export const RUN = `qa9${Date.now().toString(36)}`;

/** Igual que prisma/seed.ts: AES-256-GCM iv:tag:ct (base64) con PARTNER_TOTP_KEY. */
export function encryptSecret(plain: string): string {
  const raw = process.env.PARTNER_TOTP_KEY ?? "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("PARTNER_TOTP_KEY (32 bytes) requerido para las E2E @socios");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64")).join(":");
}

export const totp = () => generateSync({ secret: SECRET, guardrails: createGuardrails({ MIN_SECRET_BYTES: 10 }) });

let n = 0;
const hash = bcrypt.hash(PASS, 4);
export async function mkPartner(over: { dailyQuota?: number | null; discountPct?: number | null } = {}) {
  return db.partner.create({
    data: {
      email: `${RUN}-${++n}-${Math.random().toString(36).slice(2, 6)}@qa.local`, name: `QA Socio ${n}`, company: `QA Empresa ${RUN}`,
      passwordHash: await hash, totpSecretEnc: encryptSecret(SECRET), totpEnabledAt: new Date(), ...over,
    },
  });
}

/** Productos únicos de la corrida: MXN, USD (TUBERIA) y uno de 0 (no debe salir). Término de búsqueda = RUN. */
export async function ensureProducts() {
  const mk = (s: string, extra: Record<string, unknown>) =>
    db.product.upsert({
      where: { sku: `${RUN}-${s}` }, update: {},
      create: { sku: `${RUN}-${s}`, description: `Producto ${RUN} ${s}`, line: "REFACCIONES", cost: "5555.55", price: "7391.37", ...extra },
    });
  await mk("MXN", {});
  await mk("USD", { line: "TUBERIA", currency: "USD", price: "48.20" });
  await mk("CERO", { price: "0" });
}

/** IP falsa por prueba (X-Forwarded-For) para no agotar el límite de 30/min por IP entre proyectos. */
export async function fakeIp(page: Page) {
  const ip = `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

/** navigator.webdriver=false en todos los motores (solo flujos normales; el bloqueo por webdriver se prueba aparte). */
export async function hideWebdriver(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false, configurable: true });
  });
}

export async function partnerLogin(page: Page, email: string) {
  await page.goto("/socios/login");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel("Contraseña").fill(PASS);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL(/\/socios\/2fa/);
  await page.getByLabel("Código de 6 dígitos").fill(totp());
  await page.getByRole("button", { name: "Verificar código" }).click();
  await page.waitForURL(/\/socios$/);
}

/**
 * Escribe el término y deja que el debounce (400 ms) dispare la búsqueda; espera la respuesta de la acción.
 * No se pulsa Enter: Enter + debounce ejecutan la búsqueda dos veces (BUG-QA-01, ver prueba dedicada).
 */
export async function search(page: Page, term: string) {
  const box = page.getByLabel("Buscar producto");
  const done = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/socios", { timeout: 30_000 });
  await box.fill(term);
  await done;
  await page.waitForTimeout(300);
}

/** Todas las <img> de precio visibles y decodificadas (naturalWidth > 0). Devuelve cuántas. */
export async function expectPriceImagesLoaded(page: Page, min = 1) {
  const imgs = page.locator("img.portal-img");
  await expect(imgs.first()).toBeVisible();
  await expect.poll(async () => imgs.evaluateAll((els) => (els as HTMLImageElement[]).filter((i) => i.complete && i.naturalWidth > 0 && !i.src.startsWith("data:")).length), { timeout: 30_000 }).toBeGreaterThanOrEqual(min);
  const boxes = await imgs.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width));
  for (const w of boxes) expect(w).toBeGreaterThan(0);
  return boxes.length;
}

export async function internalLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/);
}

export async function mkUser(role: "ADMIN" | "VENTAS" | "GERENCIA", password: string) {
  const r = await db.role.findUniqueOrThrow({ where: { code: role } });
  return db.user.create({ data: { email: `${RUN}-${role.toLowerCase()}-${++n}@qa.local`, name: `QA ${role}`, passwordHash: await bcrypt.hash(password, 4), roleId: r.id } });
}

export async function cleanup() {
  await db.notification.deleteMany({ where: { OR: [{ user: { email: { startsWith: RUN } } }, { body: { contains: RUN } }] } });
  await db.auditLog.deleteMany({ where: { user: { email: { startsWith: RUN } } } }).catch(() => {});
  await db.partner.deleteMany({ where: { email: { startsWith: RUN } } });
  await db.user.deleteMany({ where: { email: { startsWith: RUN } } }).catch(() => {});
  await db.product.deleteMany({ where: { sku: { startsWith: RUN } } }).catch(() => {});
  await db.$disconnect();
}
