import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { jsonResponse } from "@/modules/sync/http";
import { MAX_APK_BYTES, publishAndroidRelease } from "@/modules/sync/releases";

export const dynamic = "force-dynamic";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? (fd.get(k) as string) : "");

/**
 * Publica un APK (multipart). Route handler en lugar de server action por el tamaño (hasta 150 MB);
 * esta ruta está fuera del matcher del middleware para que el cuerpo no se recorte. Sesión + users.manage.
 */
export async function POST(req: Request) {
  try {
    const actor = await requirePermission("users.manage");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_APK_BYTES + 1024 * 1024) throw new AppError("El APK excede 150 MB.");
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Selecciona el archivo APK.");
    if (!/\.apk$/i.test(file.name)) throw new AppError("Solo se aceptan archivos .apk");
    const release = await publishAndroidRelease(actor, {
      file, version: str(fd, "version"), minimum: str(fd, "minimum"), notes: str(fd, "notes"), iosUrl: str(fd, "iosUrl"),
    });
    revalidatePath("/sincronizacion");
    revalidatePath("/app");
    return jsonResponse({ ok: true, release, message: `Versión ${release.latest} publicada.` });
  } catch (e) {
    if (e instanceof ZodError)
      return jsonResponse({ ok: false, error: "Revisa los datos capturados.", fieldErrors: e.flatten().fieldErrors }, 400);
    if (e instanceof AppError) {
      const status = e.code === "FORBIDDEN" ? 403 : e.code === "UNAUTHENTICATED" ? 401 : 400;
      return jsonResponse({ ok: false, error: e.message }, status);
    }
    console.error("[app-release]", e instanceof Error ? e.message : "error desconocido");
    return jsonResponse({ ok: false, error: "No se pudo publicar la versión." }, 500);
  }
}
