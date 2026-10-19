// Sincroniza la versión del proyecto Xcode con mobile/package.json (fuente única, igual que Android).
//   MARKETING_VERSION      = "x.y.z" (sin prerelease)
//   CURRENT_PROJECT_VERSION = mayor*10000 + menor*100 + parche (o IOS_BUILD_NUMBER si se define, p. ej. para re-subir a TestFlight)
// Uso: node scripts/ios-version.mjs   (CI lo ejecuta antes de compilar)
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(path.resolve(here, "../package.json"), "utf8"));
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(pkg.version));
if (!m) throw new Error(`Versión inválida en package.json: ${pkg.version}`);
const [major, minor, patch] = m.slice(1).map(Number);
const marketing = `${major}.${minor}.${patch}`;
const build = process.env.IOS_BUILD_NUMBER?.trim() || String(major * 10000 + minor * 100 + patch);
if (!/^\d+(\.\d+){0,2}$/.test(build)) throw new Error(`IOS_BUILD_NUMBER inválido: ${build}`);

const pbx = path.resolve(here, "../ios/App/App.xcodeproj/project.pbxproj");
const src = await readFile(pbx, "utf8");
const out = src
  .replace(/MARKETING_VERSION = [^;]+;/g, `MARKETING_VERSION = ${marketing};`)
  .replace(/CURRENT_PROJECT_VERSION = [^;]+;/g, `CURRENT_PROJECT_VERSION = ${build};`);
if (!/MARKETING_VERSION/.test(out)) throw new Error("project.pbxproj sin MARKETING_VERSION");
if (out !== src) await writeFile(pbx, out);
console.log(`iOS ${marketing} (${build})`);
