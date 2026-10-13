// E2E del portal de socios. Todas llevan @socios (proyectos socios-* de playwright.config.ts).
// Requiere el servidor con la MISMA PARTNER_TOTP_KEY y DATABASE_URL de la BD temporal (ver docs/qa/quality-v140.md).
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import {
  cleanup, db, ensureProducts, expectPriceImagesLoaded, fakeIp, hideWebdriver, internalLogin, mkPartner, mkUser,
  partnerLogin, RUN, search,
} from "./socios-helpers";

// Las pruebas de flujo largo (barrido, admin) corren en un solo proyecto para no repetir bloqueos en cada navegador.
const SINGLE = process.env.SOCIOS_SINGLE_PROJECT ?? "socios-chromium-1280";
const onlyOnce = (ti: TestInfo) => test.skip(ti.project.name !== SINGLE, `flujo de servidor: solo en ${SINGLE}`);

test.beforeAll(ensureProducts);
test.afterAll(cleanup);
test.beforeEach(async ({ page }) => {
  await fakeIp(page);
});

const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe("portal @socios", () => {
  test("login + 2FA sin marca de agua ni scroll horizontal @socios", async ({ page }) => {
    await hideWebdriver(page);
    const p = await mkPartner();
    await page.goto("/socios/login");
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await noHScroll(page)).toBeLessThanOrEqual(0);
    await page.getByLabel("Correo electrónico").fill(p.email);
    await page.getByLabel("Contraseña").fill("mala-clave");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await expect(page.locator(".portal-error")).toContainText(/No pudimos iniciar sesión/);
    await partnerLogin(page, p.email); // vuelve a /socios/login y entra
    await expect(page.locator("canvas[aria-hidden=true]")).toHaveCount(1); // marca de agua solo con sesión
    expect(await noHScroll(page)).toBeLessThanOrEqual(0);
    const types = (await db.partnerActivity.findMany({ where: { partnerId: p.id }, select: { type: true } })).map((a) => a.type);
    expect(types).toEqual(expect.arrayContaining(["LOGIN_FAIL", "LOGIN_OK", "TOTP_OK"]));
    expect(types).not.toContain("WEBDRIVER");
  });

  test("2FA no muestra marca de agua @socios", async ({ page }) => {
    await hideWebdriver(page);
    const p = await mkPartner();
    await page.goto("/socios/login");
    await page.getByLabel("Correo electrónico").fill(p.email);
    await page.getByLabel("Contraseña").fill("Qa-Socio-2026!x");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL(/\/socios\/2fa/);
    await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    expect(await noHScroll(page)).toBeLessThanOrEqual(0);
  });

  test("búsqueda: resultados con imágenes de precio cargadas (tarjetas en móvil, tabla en escritorio) @socios", async ({ page }) => {
    await hideWebdriver(page);
    const p = await mkPartner();
    await partnerLogin(page, p.email);
    await search(page, RUN);
    await expect(page.getByRole("heading", { name: "2 resultados" })).toBeVisible();
    const n = await expectPriceImagesLoaded(page, 2);
    expect(n).toBe(2); // el producto con precio 0 no aparece
    const width = page.viewportSize()!.width;
    const theadShown = await page.locator(".portal-table thead").isVisible();
    if (width < 768) expect(theadShown, "en móvil se muestran tarjetas (sin encabezado de tabla)").toBe(false);
    else expect(theadShown).toBe(true);
    expect(await noHScroll(page)).toBeLessThanOrEqual(0);
    // Ni el precio ni el costo viajan como texto.
    const html = await page.content();
    for (const bad of ["7391", "6282", "5555", "48.20", "40.97"]) expect(html).not.toContain(bad);
    await expect(page.getByText("USD", { exact: true })).toBeVisible();
    const act = await db.partnerActivity.count({ where: { partnerId: p.id, type: "PRICE_VIEW" } });
    expect(act).toBeGreaterThanOrEqual(2);
  });

  test("difuminado al cambiar de pestaña (visibilitychange) y al blur; se revela con un toque @socios", async ({ page }) => {
    await hideWebdriver(page);
    const p = await mkPartner();
    await partnerLogin(page, p.email);
    await search(page, RUN);
    await expectPriceImagesLoaded(page, 2);
    const main = page.locator("main.shield-target");

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect(main).toHaveAttribute("data-hidden", "true");
    expect(await main.evaluate((el) => getComputedStyle(el).filter)).toContain("blur");
    await expect.poll(() => page.locator("img.portal-img").evaluateAll((els) => (els as HTMLImageElement[]).every((i) => i.src.startsWith("data:image/gif")))).toBe(true);
    await page.evaluate(() => Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true }));
    await page.getByRole("button", { name: "Toca para mostrar precios" }).click();
    await expect(main).toHaveAttribute("data-hidden", "false");
    await expectPriceImagesLoaded(page, 2);

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(main).toHaveAttribute("data-hidden", "true");
    await page.getByRole("button", { name: "Toca para mostrar precios" }).click();
    await expect(main).toHaveAttribute("data-hidden", "false");
    await expect.poll(() => db.partnerActivity.count({ where: { partnerId: p.id, type: "HIDDEN" } })).toBeGreaterThanOrEqual(1);
  });

  test("impresión en blanco (media print oculta el body) @socios", async ({ page }) => {
    await hideWebdriver(page);
    const p = await mkPartner();
    await partnerLogin(page, p.email);
    await search(page, RUN);
    await expectPriceImagesLoaded(page, 2);
    await page.emulateMedia({ media: "print" });
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).toBe("none");
    await page.emulateMedia({ media: "screen" });
    expect(await page.evaluate(() => getComputedStyle(document.body).display)).not.toBe("none");
  });

  test("cuota agotada (dailyQuota=2) @socios", async ({ page }) => {
    await hideWebdriver(page);
    const p = await mkPartner({ dailyQuota: 2 });
    await partnerLogin(page, p.email);
    await expect(page.getByText(/Te quedan 2 búsquedas hoy/)).toBeVisible();
    await search(page, RUN);
    await expect(page.getByText(/Te quedan 1 búsquedas hoy/)).toBeVisible();
    await search(page, `${RUN} mxn`);
    await expect(page.getByText("Llegaste al límite de búsquedas de hoy")).toBeVisible();
    await expect(page.getByLabel("Buscar producto")).toBeDisabled();
    await page.reload();
    await expect(page.getByText("Llegaste al límite de búsquedas de hoy")).toBeVisible();
    expect(await noHScroll(page)).toBeLessThanOrEqual(0);
    expect((await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("ACTIVE");
  });
});

test("Enter tras escribir consume UNA sola búsqueda (BUG-QA-01) @socios", async ({ page }, ti) => {
  onlyOnce(ti);
  await hideWebdriver(page);
  const p = await mkPartner({ dailyQuota: 10 });
  await partnerLogin(page, p.email);
  const box = page.getByLabel("Buscar producto");
  await box.fill(RUN);
  await page.waitForTimeout(150); // un humano: escribe y pulsa Enter antes de los 400 ms del debounce
  await box.press("Enter");
  await page.waitForTimeout(3000);
  expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "SEARCH" } })).toBe(1);
});

test.describe("defensas anti-scraping @socios", () => {
  test("barrido a..z, aa..az y luego aaa..: termina BLOQUEADO con actividad y aviso al ADMIN @socios", async ({ page }, ti) => {
    onlyOnce(ti);
    test.setTimeout(180_000);
    await hideWebdriver(page);
    const admin = await mkUser("ADMIN", "Qa9-Admin-2026!");
    const p = await mkPartner({ dailyQuota: 500 });
    await partnerLogin(page, p.email);
    const box = page.getByLabel("Buscar producto");
    const short = [..."abcdefghijklmnopqrstuvwxyz", ..."abcdefghijklmnopqrstuvwxyz".split("").map((c) => `a${c}`)];
    for (const t of short) {
      await box.fill(t);
      await page.waitForTimeout(450); // < 3 letras: ni el cliente ni el servidor la ejecutan
    }
    // Hallazgo: términos de 1-2 letras no llegan al servidor (mín. 3) y no cuentan para la detección.
    const afterShort = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    ti.annotations.push({ type: "short-sweep", description: `estado tras a..z/aa..az: ${afterShort.status}; SEARCH=${await db.partnerActivity.count({ where: { partnerId: p.id, type: "SEARCH" } })}` });

    // Barrido de 3 letras (aaa, aab, …): el detector debe cortar.
    for (const c of "abcdefghijklmnopqrstuvwxyz") {
      if (await page.getByText("Tu cuenta está bloqueada", { exact: true }).isVisible()) break;
      if (await box.isDisabled()) break; // pausa por ráfaga
      await search(page, `aa${c}`).catch(() => {});
    }
    await expect.poll(async () => (await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status, { timeout: 20_000 }).toBe("BLOCKED");
    const types = new Set((await db.partnerActivity.findMany({ where: { partnerId: p.id }, select: { type: true } })).map((a) => a.type));
    expect(types.has("AUTO_BLOCK")).toBe(true);
    expect(types.has("SWEEP_SUSPECT") || types.has("RATE_LIMITED")).toBe(true);
    await expect.poll(() => db.notification.count({ where: { userId: admin.id, kind: "partner_blocked" } })).toBe(1);
    expect(await db.partnerSession.count({ where: { partnerId: p.id } })).toBe(0);
    // La sesión ya no sirve.
    await page.goto("/socios");
    await expect(page).toHaveURL(/\/socios\/login/);
  });

  test("navigator.webdriver=true bloquea de inmediato @socios", async ({ page }, ti) => {
    onlyOnce(ti);
    const admin = await mkUser("ADMIN", "Qa9-Admin-2026!");
    const p = await mkPartner();
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => true, configurable: true }));
    await partnerLogin(page, p.email);
    await expect.poll(async () => (await db.partner.findUniqueOrThrow({ where: { id: p.id } })).status, { timeout: 10_000 }).toBe("BLOCKED");
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "WEBDRIVER" } })).toBe(1);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "AUTO_BLOCK" } })).toBe(1);
    // El aviso se crea después del AUTO_BLOCK (misma petición, pasos siguientes): se espera, no se lee al instante.
    await expect.poll(() => db.notification.count({ where: { userId: admin.id, kind: "partner_blocked" } }), { timeout: 10_000 }).toBe(1);
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "SEARCH" } })).toBe(0);
  });

  test("honeypot /socios/catalogo-completo bloquea @socios", async ({ page }, ti) => {
    onlyOnce(ti);
    await hideWebdriver(page);
    const p = await mkPartner();
    await partnerLogin(page, p.email);
    const res = await page.goto("/socios/catalogo-completo");
    expect(res?.status()).toBe(404);
    const row = await db.partner.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.status).toBe("BLOCKED");
    expect(row.blockedReason).toBe("HONEYPOT");
    expect(await db.partnerActivity.count({ where: { partnerId: p.id, type: "HONEYPOT" } })).toBe(1);
  });
});

test.describe("administración @socios", () => {
  const ADMIN_PW = "Qa9-Admin-2026!";
  let saved: { key: string; value: unknown }[] = [];
  test.beforeAll(async () => {
    saved = (await db.setting.findMany({ where: { key: { startsWith: "partners." } } })).map((s) => ({ key: s.key, value: s.value }));
  });
  test.afterAll(async () => {
    for (const s of saved) await db.setting.update({ where: { key: s.key }, data: { value: s.value as never } });
  });

  test("ADMIN cambia el descuento global a 20%; override por socio gana; búsqueda del socio sigue mostrando precios @socios", async ({ browser, page }, ti) => {
    onlyOnce(ti);
    const admin = await mkUser("ADMIN", ADMIN_PW);
    await internalLogin(page, admin.email, ADMIN_PW);
    await page.goto("/socios-admin/ajustes");
    await page.getByLabel("Descuento global (%)").fill("20");
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText(/Descuento global actualizado a 20/)).toBeVisible();
    expect(Number((await db.setting.findUniqueOrThrow({ where: { key: "partners.discountPct" } })).value)).toBe(20);
    await expect(page.getByText(/se muestra a \$800\.00/)).toBeVisible();

    // Override: socio con 10% propio desde la ficha.
    const p = await mkPartner();
    await page.goto(`/socios-admin/${p.id}`);
    await expect(page.getByText(/20\s?% · global/)).toBeVisible();
    await page.getByLabel("Descuento propio (%)").fill("10");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect.poll(async () => (await db.partner.findUniqueOrThrow({ where: { id: p.id } })).discountPct?.toString()).toBe("10");
    await page.reload();
    await expect(page.getByText(/10\s?% · propio/)).toBeVisible();

    // El socio (otro contexto) busca: las imágenes cargan con el precio nuevo (el monto se verifica en
    // tests/integration/partners-qa.test.ts con un espía de renderPriceImage).
    const ctx = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": "10.9.250.250" } });
    const sp = await ctx.newPage();
    await hideWebdriver(sp);
    await partnerLogin(sp, p.email);
    await search(sp, RUN);
    await expectPriceImagesLoaded(sp, 2);
    await ctx.close();
  });

  test("historial muestra eventos y filtra por tipo, socio y fecha @socios", async ({ page }, ti) => {
    onlyOnce(ti);
    const admin = await mkUser("ADMIN", ADMIN_PW);
    const a = await mkPartner();
    const b = await mkPartner();
    await db.partnerActivity.createMany({ data: [
      { partnerId: a.id, type: "SEARCH", meta: { term: "qa-hist", count: 1 } },
      { partnerId: a.id, type: "HONEYPOT" },
      { partnerId: b.id, type: "SEARCH", meta: { term: "qa-hist-b", count: 0 } },
    ] });
    await internalLogin(page, admin.email, ADMIN_PW);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(new Date());
    await page.goto(`/socios-admin/historial?partnerId=${a.id}`);
    await expect(page.locator("tbody tr")).toHaveCount(2);
    await expect(page.locator("tbody").getByText(b.name)).toHaveCount(0);
    await page.goto(`/socios-admin/historial?partnerId=${a.id}&type=HONEYPOT&from=${today}&to=${today}`);
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.goto(`/socios-admin/historial?partnerId=${a.id}&from=2001-01-01&to=2001-01-02`);
    await expect(page.locator("tbody tr")).toHaveCount(0);
    // UI del filtro: elegir tipo en el select y aplicar.
    await page.goto("/socios-admin/historial");
    await page.getByLabel("Socio").selectOption(b.id);
    await page.getByLabel("Tipo de evento").selectOption("SEARCH");
    await page.locator("form[aria-label='Filtros del historial']").evaluate((f: HTMLFormElement) => f.requestSubmit());
    await expect(page).toHaveURL(new RegExp(`partnerId=${b.id}`));
    await expect(page.locator("tbody tr")).toHaveCount(1);
  });

  test("historial registra el cambio del descuento global (spec Agente 9 paso 4) @socios", async ({ page }, ti) => {
    onlyOnce(ti);
    test.fail(true, "BUG-QA-02: el cambio global solo va a AuditLog, no aparece en /socios-admin/historial");
    const admin = await mkUser("ADMIN", ADMIN_PW);
    await internalLogin(page, admin.email, ADMIN_PW);
    await page.goto("/socios-admin/ajustes");
    await page.getByLabel("Descuento global (%)").fill("18");
    await page.getByRole("button", { name: "Guardar ajustes" }).click();
    await expect(page.getByText(/Descuento global actualizado a 18/)).toBeVisible();
    await page.goto("/socios-admin/historial");
    await expect(page.getByText(/18\s?%/).first()).toBeVisible({ timeout: 3000 });
  });

  for (const role of ["VENTAS", "GERENCIA"] as const) {
    test(`${role} no entra a /socios-admin @socios`, async ({ page }, ti) => {
      onlyOnce(ti);
      const u = await mkUser(role, "Qa9-User-2026!");
      await internalLogin(page, u.email, "Qa9-User-2026!");
      for (const path of ["/socios-admin", "/socios-admin/ajustes", "/socios-admin/historial"]) {
        await page.goto(path);
        await expect(page).toHaveURL(/denied=1/);
      }
    });
  }
});
