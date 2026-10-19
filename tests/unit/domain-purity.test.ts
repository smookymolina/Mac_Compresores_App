import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// src/domain debe poder empaquetarse solo (app móvil): solo imports relativos o librerías permitidas.
const ROOT = path.resolve(__dirname, "../../src/domain");
const ALLOWED = new Set(["decimal.js", "pdf-lib"]);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

const SPEC_RE = /(?:import|export)\s[^"';]*?from\s*["']([^"']+)["']|import\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|require\(\s*["']([^"']+)["']\s*\)/g;

describe("pureza de src/domain", () => {
  const files = walk(ROOT);

  it("encuentra archivos de dominio", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [path.relative(ROOT, f), f]))("%s solo importa rutas relativas o permitidas", (_n, file) => {
    const src = fs.readFileSync(file, "utf8");
    const bad: string[] = [];
    for (const m of src.matchAll(SPEC_RE)) {
      const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const target = path.resolve(path.dirname(file), spec);
        if (!target.startsWith(ROOT)) bad.push(spec); // relativo que sale de src/domain
        continue;
      }
      if (!ALLOWED.has(spec)) bad.push(spec);
    }
    expect(bad).toEqual([]);
  });
});
