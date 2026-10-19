// Genera los íconos de lanzador Android desde ../public/icons (PWA). Uso: node scripts/android-icons.mjs
// sharp se resuelve desde node_modules de la raíz del repo.
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const icons = path.resolve(here, "../../public/icons");
const res = path.resolve(here, "../android/app/src/main/res");
const densities = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

for (const [d, f] of Object.entries(densities)) {
  const dir = path.join(res, `mipmap-${d}`);
  await mkdir(dir, { recursive: true });
  const legacy = Math.round(48 * f);
  const fg = Math.round(108 * f);
  await sharp(path.join(icons, "icon-512.png")).resize(legacy, legacy).png().toFile(path.join(dir, "ic_launcher.png"));
  const mask = Buffer.from(`<svg width="${legacy}" height="${legacy}"><circle cx="${legacy / 2}" cy="${legacy / 2}" r="${legacy / 2}"/></svg>`);
  await sharp(path.join(icons, "icon-maskable-512.png"))
    .resize(legacy, legacy)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toFile(path.join(dir, "ic_launcher_round.png"));
  // Adaptativo (API 26+): el maskable es a sangre completa; su zona segura (80 %) cubre la vista de 72/108 dp.
  await sharp(path.join(icons, "icon-maskable-512.png")).resize(fg, fg).png().toFile(path.join(dir, "ic_launcher_foreground.png"));
}
console.log("Íconos Android generados en", res);
