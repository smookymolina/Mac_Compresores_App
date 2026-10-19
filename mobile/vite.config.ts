import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const pkg = JSON.parse(readFileSync(r("./package.json"), "utf8")) as { version: string };

// `@domain` → reglas compartidas del servidor (../src/domain, puras: decimal.js + pdf-lib).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: {
    alias: { "@domain": r("../src/domain"), "@": r("./src") },
    // Las dependencias de ../src/domain se resuelven desde mobile/node_modules.
    dedupe: ["decimal.js", "pdf-lib", "react", "react-dom"],
  },
  server: { fs: { allow: [r(".."), r(".")] } },
  build: { outDir: "dist", target: "es2022", sourcemap: false },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
