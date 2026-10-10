import { shareErrorResponse, shareRateLimited } from "@/lib/share";
import { uuid } from "@/lib/validation";
import { loadSharedQuote } from "@/modules/quotes/email";
import { renderQuotePdf } from "@/modules/quotes/pdf";

/**
 * Enlace público (sin sesión) al PDF de una cotización, enviado por WhatsApp.
 * Válido solo con firma HMAC vigente (?t=…); se genera con el alcance de quien lo compartió.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    if (!uuid.safeParse(id).success) return shareErrorResponse(404);
    if (await shareRateLimited(req)) return shareErrorResponse(429);
    const q = await loadSharedQuote(new URL(req.url).searchParams.get("t"), id);
    if (!q) return shareErrorResponse(404);
    const bytes = await renderQuotePdf(q);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="cotizacion-C${q.folio}.pdf"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
        "Referrer-Policy": "no-referrer",
      },
    });
  } catch (e) {
    console.error("[compartir] cotización:", e instanceof Error ? e.message : e);
    return shareErrorResponse(500);
  }
}
