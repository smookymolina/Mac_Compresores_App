import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { REPORTS, buildReport, type ReportKind } from "@/modules/reports/service";

const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((s) => new Date(`${s}T00:00:00Z`));

export async function GET(req: Request, { params }: { params: Promise<{ tipo: string }> }) {
  try {
    const user = await requirePermission("reports.export");
    const { tipo } = await params;
    if (!(tipo in REPORTS)) throw new AppError("Reporte no encontrado", "NOT_FOUND");
    const url = new URL(req.url);
    const now = new Date();
    const from = url.searchParams.get("desde") ? dateParam.parse(url.searchParams.get("desde")) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const to = url.searchParams.get("hasta") ? dateParam.parse(url.searchParams.get("hasta")) : now;
    if (to < from) throw new AppError("La fecha final es anterior a la inicial.");
    if (to.getTime() - from.getTime() > 3 * 366 * 864e5) throw new AppError("El rango máximo es de 3 años.");
    const { filename, csv } = await buildReport(user, tipo as ReportKind, from, to);
    await audit({ userId: user.id, action: "report.export", entity: "Report", data: { tipo, from: from.toISOString(), to: to.toISOString() } });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    if (e instanceof AppError || e instanceof z.ZodError) {
      const status = e instanceof AppError ? (e.code === "UNAUTHENTICATED" ? 401 : e.code === "FORBIDDEN" ? 403 : e.code === "NOT_FOUND" ? 404 : 400) : 400;
      return NextResponse.json({ error: e instanceof AppError ? e.message : "Fechas inválidas" }, { status });
    }
    console.error("[reporte]", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Error al generar el reporte" }, { status: 500 });
  }
}
