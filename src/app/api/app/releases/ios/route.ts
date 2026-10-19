import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { jsonResponse } from "@/modules/sync/http";
import { MAX_IPA_BYTES, publishIosRelease } from "@/modules/sync/releases";

export const dynamic = "force-dynamic";

/** Publica un IPA Ad Hoc (multipart, hasta 200 MB). Igual que /api/app/releases: fuera del matcher del middleware. */
export async function POST(req: Request) {
  try {
    const actor = await requirePermission("users.manage");
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_IPA_BYTES + 1024 * 1024) throw new AppError("El IPA excede 200 MB.");
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new AppError("Selecciona el archivo IPA.");
    if (!/\.ipa$/i.test(file.name)) throw new AppError("Solo se aceptan archivos .ipa");
    const version = typeof fd.get("version") === "string" ? (fd.get("version") as string) : "";
    const release = await publishIosRelease(actor, { file, version });
    revalidatePath("/sincronizacion");
    revalidatePath("/app");
    return jsonResponse({ ok: true, release, message: `Versión iOS ${release.ios?.latest} publicada.` });
  } catch (e) {
    if (e instanceof ZodError)
      return jsonResponse({ ok: false, error: "Revisa los datos capturados.", fieldErrors: e.flatten().fieldErrors }, 400);
    if (e instanceof AppError) {
      const status = e.code === "FORBIDDEN" ? 403 : e.code === "UNAUTHENTICATED" ? 401 : 400;
      return jsonResponse({ ok: false, error: e.message }, status);
    }
    console.error("[app-release-ios]", e instanceof Error ? e.message : "error desconocido");
    return jsonResponse({ ok: false, error: "No se pudo publicar la versión." }, 500);
  }
}
