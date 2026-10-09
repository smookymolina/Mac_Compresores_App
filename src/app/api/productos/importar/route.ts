import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { importProducts } from "@/modules/products/service";

const MAX_BYTES = 20 * 1024 * 1024;

export async function POST(req: Request) {
  try {
    const user = await requirePermission("products.import");
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) throw new AppError("Selecciona un archivo CSV.");
    if (file.size > MAX_BYTES) throw new AppError("El archivo excede 20 MB.");
    if (!/\.csv$/i.test(file.name)) throw new AppError("Solo se aceptan archivos .csv");
    const result = await importProducts(user.id, await file.text());
    // Todos los errores (para descargarlos y corregir el archivo) y un resumen por tipo.
    const byType: Record<string, number> = {};
    for (const er of result.errors) {
      const t = er.message.startsWith("SKU duplicado") ? "SKU duplicado" : er.message.startsWith("Tipo no reconocido") ? "Tipo no reconocido" : "Otros";
      byType[t] = (byType[t] ?? 0) + 1;
    }
    return NextResponse.json({ ok: true, ...result, errors: result.errors.slice(0, 50_000), errorCount: result.errors.length, byType });
  } catch (e) {
    const status = e instanceof AppError ? (e.code === "FORBIDDEN" ? 403 : e.code === "UNAUTHENTICATED" ? 401 : 400) : 500;
    const message = e instanceof AppError ? e.message : "Error al importar.";
    if (!(e instanceof AppError)) console.error("[import]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
