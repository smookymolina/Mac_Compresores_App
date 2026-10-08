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
  ],
  webServer: external
    ? undefined
    : { command: "npm run start -- -p 3100", url: "http://localhost:3100/login", reuseExistingServer: true, timeout: 120_000 },
});
