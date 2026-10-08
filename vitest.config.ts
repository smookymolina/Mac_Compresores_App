import path from "node:path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
      },
    },
    test: {
      include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts"],
      // Las pruebas de integración usan una BD aislada; nunca la de desarrollo.
      env: { DATABASE_URL: env.TEST_DATABASE_URL ?? "" },
      globalSetup: ["tests/global-setup.ts"],
      fileParallelism: false,
      testTimeout: 30_000,
      hookTimeout: 60_000,
    },
  };
});
