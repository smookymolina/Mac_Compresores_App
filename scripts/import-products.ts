/** Uso: npm run import:products -- ruta/al/archivo.csv  (exporta "Lista precios" a CSV UTF-8 desde Excel) */
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { importProducts } from "@/modules/products/service";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Indica la ruta del CSV.");
  const admin = await db.user.findFirstOrThrow({ where: { role: { code: "ADMIN" } } });
  const r = await importProducts(admin.id, readFileSync(file, "utf8"));
  console.log(`Creados: ${r.created} · Actualizados: ${r.updated} · Sin cambios: ${r.unchanged} · Errores: ${r.errors.length}`);
  r.errors.slice(0, 20).forEach((e) => console.log(`  fila ${e.row}: ${e.message}`));
}
main().finally(() => db.$disconnect());
