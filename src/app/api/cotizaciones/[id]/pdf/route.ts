import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getQuote } from "@/modules/quotes/service";
import { renderQuotePdf } from "@/modules/quotes/pdf";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requirePermission("quotes.read_all", "quotes.read_own");
    const { id } = await params;
    if (!uuid.safeParse(id).success) throw new AppError("No encontrada", "NOT_FOUND");
    const quote = await getQuote(user, id); // aplica control de acceso por objeto
    const bytes = await renderQuotePdf(quote);
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="cotizacion-C${quote.folio}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError) {
      const status = e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : 404;
      return NextResponse.json({ error: e.message }, { status });
    }
    console.error("[pdf]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Error al generar PDF" }, { status: 500 });
  }
}
