// Copia las imágenes del PDF de cotización desde ../public/brand (fuente única) a public/brand (ignorado en git).
import { copyFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = (f) => fileURLToPath(new URL(`../../public/brand/${f}`, import.meta.url));
const dst = fileURLToPath(new URL("../public/brand/", import.meta.url));
mkdirSync(dst, { recursive: true });
for (const f of ["quote-header.png", "quote-footer.png", "milwaukee.jpg"]) copyFileSync(src(f), dst + f);
