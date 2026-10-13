import { defineConfig, devices } from "@playwright/test";

// E2E contra la BD sembrada con SEED_DEMO=1 (ver README).
// E2E_BASE_URL=http://localhost:3080 prueba el contenedor Docker en lugar de levantar `next start`.
const external = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: external ?? "http://localhost:3100", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    // Navegadores adicionales (instalar con `npx playwright install webkit firefox`).
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    // Viewports de referencia: 360x740 y 390x844 (móvil) y 1280x800 (escritorio).
    { name: "vp-360", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true } },
    { name: "vp-390", use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "vp-1280", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    // Portal de socios: vive en /socios del mismo host (sin subdominio), así que el baseURL es el mismo
    // y los tests usan rutas /socios/... Solo corre los tests marcados con @socios (npx playwright test --project=socios).
    { name: "socios", grep: /@socios/, use: { ...devices["Desktop Chrome"] } },
    { name: "socios-mobile", grep: /@socios/, use: { ...devices["Pixel 7"] } },
    { name: "socios-webkit", grep: /@socios/, use: { ...devices["Desktop Safari"] } },
    // Matriz QA v1.4.0: chromium/webkit/firefox × 360/390/1280 (npx playwright test --project='socios-*-*').
    // Chromium sin la marca AutomationControlled (si no, navigator.webdriver=true dispara el autoBloqueo, correcto);
    // en webkit/firefox los flujos normales fuerzan navigator.webdriver=false con addInitScript (ver tests/e2e/socios-helpers.ts).
    ...(["chromium", "webkit", "firefox"] as const).flatMap((b) =>
      [360, 390, 1280].map((w) => ({
        name: `socios-${b}-${w}`,
        grep: /@socios/,
        use: {
          ...devices[b === "chromium" ? "Desktop Chrome" : b === "webkit" ? "Desktop Safari" : "Desktop Firefox"],
          viewport: { width: w, height: w < 768 ? (w === 360 ? 740 : 844) : 800 },
          ...(w < 768 && b !== "firefox" ? { isMobile: true, hasTouch: true } : {}),
          ...(b === "chromium" ? { launchOptions: { args: ["--disable-blink-features=AutomationControlled"] } } : {}),
        },
      })),
    ),
  ],
  webServer: external
    ? undefined
    : { command: "npm run start -- -p 3100", url: "http://localhost:3100/login", reuseExistingServer: true, timeout: 120_000 },
});
