import { AppError } from "@/lib/errors";
import { shareErrorResponse, shareRateLimited } from "@/lib/share";
import { loadSharedReport } from "@/modules/reports/send";

/**
 * Enlace público (sin sesión) a un reporte CSV, enviado por WhatsApp.
 * Válido solo con firma HMAC vigente (?t=…); el reporte se genera con los filtros firmados y el alcance de quien lo compartió.
 */
export async function GET(req: Request, { params }: { params: Promise<{ tipo: string }> }) {
  try {
    const { tipo } = await params;
    if (await shareRateLimited(req)) return shareErrorResponse(429);
    const r = await loadSharedReport(new URL(req.url).searchParams.get("t"), tipo);
    if (!r) return shareErrorResponse(404);
    return new Response(r.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${r.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    if (e instanceof AppError) return shareErrorResponse(404);
    console.error("[compartir] reporte:", e instanceof Error ? e.message : e);
    return shareErrorResponse(500);
  }
}
