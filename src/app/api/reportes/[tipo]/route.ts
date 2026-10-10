import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { audit } from "@/lib/audit";
import { buildReport, isReportKind, resolveRange } from "@/modules/reports/service";

export async function GET(req: Request, { params }: { params: Promise<{ tipo: string }> }) {
  try {
    const user = await requirePermission("reports.export");
    const { tipo } = await params;
    if (!isReportKind(tipo)) throw new AppError("Reporte no encontrado", "NOT_FOUND");
    const url = new URL(req.url);
    const { from, to } = resolveRange(url.searchParams.get("desde"), url.searchParams.get("hasta"));
    const { filename, csv } = await buildReport(user, tipo, from, to);
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
