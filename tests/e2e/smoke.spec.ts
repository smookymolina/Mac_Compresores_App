import { expect, test, type Page } from "@playwright/test";

const PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "";

async function login(page: Page, email: string, password = PASSWORD, expectOk = true) {
  await page.goto("/login");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  if (expectOk) await page.waitForURL(/\/dashboard/);
}

test("rechaza credenciales inválidas", async ({ page }) => {
  // Correo único: el límite de intentos vive en la BD y sobrevive entre corridas.
  await login(page, `nadie-${Date.now()}@demo.local`, "incorrecta123", false);
  await expect(page.getByRole("status")).toHaveText(/inválidos/);
});

test("rutas protegidas redirigen a login", async ({ page }) => {
  await page.goto("/cotizaciones");
  await expect(page).toHaveURL(/\/login/);
});

test("ventas no accede a usuarios", async ({ page }) => {
  await login(page, "ventas1@demo.local");
  await page.goto("/usuarios");
  await expect(page).toHaveURL(/denied=1/);
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
});

test("vendedor crea cotización y descarga PDF", async ({ page }) => {
  await login(page, "ventas1@demo.local");
  await page.goto("/cotizaciones/nueva");
  await page.getByLabel("Cliente").selectOption({ label: "[DEMO] Industrias Ejemplo SA de CV" });
  await page.getByLabel("Agregar producto o servicio").fill("DEMO-SEP");
  await page.getByRole("button", { name: /DEMO-SEP-001/ }).click();
  await page.getByLabel("Cantidad").fill("2");
  await page.getByRole("button", { name: "Guardar cotización" }).click();
  await expect(page.getByRole("heading", { name: /Cotización C-\d+/ })).toBeVisible();
  await expect(page.getByText("$3,480.00").first()).toBeVisible();
  const pdfHref = await page.getByRole("link", { name: "PDF" }).getAttribute("href");
  const res = await page.request.get(pdfHref!);
  expect(res.headers()["content-type"]).toBe("application/pdf");
});

test("gerencia: cotización → aceptada → venta con salida de inventario", async ({ page }) => {
  await login(page, "gerencia@demo.local");
  await page.goto("/cotizaciones/nueva");
  await page.getByLabel("Cliente").selectOption({ label: "[DEMO] Industrias Ejemplo SA de CV" });
  await page.getByLabel("Agregar producto o servicio").fill("DEMO-FIL");
  await page.getByRole("button", { name: /DEMO-FIL-002/ }).click();
  await page.getByLabel("Descuento").fill("20"); // gerencia puede exceder 15%
  await page.getByRole("button", { name: "Guardar cotización" }).click();
  await expect(page.getByRole("heading", { name: /Cotización C-\d+/ })).toBeVisible();

  for (const to of ["Enviada", "Aceptada"]) {
    await page.getByLabel("Nuevo estado").selectOption({ label: to });
    await page.getByRole("button", { name: "Cambiar estado" }).click();
    await expect(page.getByText(to, { exact: true }).first()).toBeVisible();
  }
  await page.getByLabel("Confirmo que el cliente aceptó esta cotización.").check();
  await page.getByRole("button", { name: "Convertir en venta" }).click();
  await expect(page.getByRole("heading", { name: /Venta V-\d+/ })).toBeVisible();
  await expect(page.getByText("Confirmada")).toBeVisible();
});

// Regresión: con un loading.tsx en (app), las acciones con revalidatePath dejaban el botón en «Procesando…».
test("almacén registra una entrada y el formulario confirma", async ({ page }) => {
  await login(page, "almacen@demo.local");
  await page.goto("/inventario");
  await page.getByLabel("SKU", { exact: true }).fill("DEMO-FIL-002");
  await page.getByLabel("Cantidad", { exact: true }).fill("1");
  await page.getByLabel("Motivo / referencia", { exact: true }).fill("Entrada de prueba e2e");
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByText("Movimiento registrado.").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Registrar", exact: true })).toBeEnabled();
});
