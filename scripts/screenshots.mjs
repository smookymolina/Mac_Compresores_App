// Capturas de revisión visual (Playwright) + comprobación de scroll horizontal.
// Uso: node scripts/screenshots.mjs <carpeta-salida> [baseURL]
// Requiere la app en marcha y la BD sembrada con SEED_DEMO=1 (usuario gerencia@demo.local).
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = process.argv[2] ?? "screenshots";
const base = process.argv[3] ?? "http://localhost:3100";
const password = process.env.SEED_ADMIN_PASSWORD ?? "";
const viewports = [
  { name: "mobile-375", width: 375, height: 812, isMobile: true, hasTouch: true },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "desktop-1440", width: 1440, height: 900 },
];
const pages = [
  ["dashboard", "/dashboard"],
  ["lista-cotizaciones", "/cotizaciones"],
  ["lista-productos", "/productos"],
  ["inventario", "/inventario"],
  ["form-cliente", "/clientes/nuevo"],
  ["form-cotizacion", "/cotizaciones/nueva"],
  ["comisiones", "/comisiones"],
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
let overflow = 0;

for (const { name, ...vp } of viewports) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.hasTouch });
  const page = await ctx.newPage();
  const check = async (label) => {
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    const bad = w.sw > w.iw;
    if (bad) overflow++;
    console.log(`${bad ? "OVERFLOW" : "ok      "} ${name} ${label} (${w.sw}/${w.iw})`);
  };

  await page.goto(`${base}/login`);
  await page.screenshot({ path: `${out}/${name}-login.png` });
  await check("login");

  await page.getByLabel("Correo").fill("gerencia@demo.local");
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL(/\/dashboard/);

  for (const [label, path] of pages) {
    await page.goto(`${base}${path}`);
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(450); // deja terminar las animaciones de entrada
    await page.screenshot({ path: `${out}/${name}-${label}.png`, fullPage: false });
    await check(label);
  }

  // Drawer de navegación (móvil) o menú de usuario (tablet/escritorio).
  await page.goto(`${base}/dashboard`);
  const menu = page.getByRole("button", { name: "Abrir menú" });
  if (await menu.isVisible().catch(() => false)) {
    await menu.click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${out}/${name}-drawer.png` });
  } else {
    const user = page.getByRole("button", { name: /Cuenta|Menú de usuario/ });
    if (await user.isVisible().catch(() => false)) {
      await user.click();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${out}/${name}-menu-usuario.png` });
    }
  }
  await ctx.close();
}

await browser.close();
console.log(overflow === 0 ? "Sin scroll horizontal de página." : `${overflow} vista(s) con scroll horizontal.`);
process.exitCode = overflow === 0 ? 0 : 1;
