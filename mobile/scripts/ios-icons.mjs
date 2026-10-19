// Genera el AppIcon iOS (1024×1024, opaco, sin canal alfa) desde ../public/icons. Uso: node scripts/ios-icons.mjs
// Se usa icon-maskable-512.png (a sangre completa y opaco): iOS aplica su propia máscara redondeada y rechaza íconos con transparencia.
// sharp se resuelve desde node_modules de la raíz del repo.
import sharp from "sharp";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "../../public/icons/icon-maskable-512.png");
const dir = path.resolve(here, "../ios/App/App/Assets.xcassets/AppIcon.appiconset");
const file = "AppIcon-512@2x.png";

await sharp(src).resize(1024, 1024, { kernel: "lanczos3" }).flatten({ background: "#ffffff" }).removeAlpha().png().toFile(path.join(dir, file));
await writeFile(
  path.join(dir, "Contents.json"),
  JSON.stringify({ images: [{ filename: file, idiom: "universal", platform: "ios", size: "1024x1024" }], info: { author: "xcode", version: 1 } }, null, 2) + "\n",
);
console.log("AppIcon iOS generado en", dir);
