import "server-only";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { renderEmail } from "@/lib/email-layout";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { REPORT_SHARE_TTL_MS, createShareLink, loadShareUser, readShareToken } from "@/lib/share";
import { fmtDate } from "@/lib/utils";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { REPORTS, buildReport, isReportKind, resolveRange, type ReportKind } from "./service";

/** Filtros tal como llegan del formulario («YYYY-MM-DD» o null). */
export interface ReportFilters {
  desde: string | null;
  hasta: string | null;
}

const periodLabel = (kind: ReportKind, from: Date, to: Date) =>
  REPORTS[kind].dated ? `${fmtDate(from)} al ${fmtDate(to)}` : `Al ${fmtDate(new Date())}`;

/** Envía el CSV por correo (Reply-To = quien lo envía). Mismos datos y permisos que la descarga. */
export async function emailReport(user: CurrentUser, kind: ReportKind, f: ReportFilters, input: { to: string[]; cc: string[]; message: string }) {
  if (!isMailConfigured()) throw new AppError("El envío de correos no está configurado. Contacta al administrador.");
  assertCan(user, "reports.export");
  const { from, to } = resolveRange(f.desde, f.hasta);
  const { filename, csv } = await buildReport(user, kind, from, to);
  const r = REPORTS[kind];
  const period = periodLabel(kind, from, to);
  const { html, text } = renderEmail({
    preheader: `Reporte «${r.title}» (${period}) en CSV.`,
    eyebrow: "Reporte",
    title: r.title,
    paragraphs: input.message.split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean),
    details: [
      { label: "Reporte", value: r.title },
      { label: r.dated ? "Periodo" : "Existencias", value: period },
      { label: "Archivo", value: filename },
      { label: "Enviado por", value: user.name },
    ],
    notes: ["El archivo CSV adjunto se abre directo en Excel."],
    signature: [user.name, user.email, "MAC Compresores"],
  });
  try {
    await sendMail({
      to: input.to,
      cc: input.cc.length ? input.cc : undefined,
      replyTo: user.email,
      subject: `Reporte: ${r.title} · MAC Compresores`,
      text,
      html,
      attachments: [{ filename, content: Buffer.from(csv, "utf8"), contentType: "text/csv; charset=utf-8" }],
    });
  } catch (e) {
    console.error("[mail] reporte:", e instanceof Error ? e.message : e);
    throw new AppError("No se pudo enviar el correo. Revisa la dirección e inténtalo de nuevo.");
  }
  await audit({ userId: user.id, action: "report.email", entity: "Report",
    data: { tipo: kind, from: from.toISOString(), to: to.toISOString(), recipients: input.to, cc: input.cc } });
}

/** Enlace público firmado (7 días) al CSV con los mismos filtros, generado con el alcance de quien lo comparte. */
export function shareReportLink(user: CurrentUser, kind: ReportKind, f: ReportFilters) {
  assertCan(user, "reports.export");
  resolveRange(f.desde, f.hasta); // valida antes de firmar
  const dated = REPORTS[kind].dated;
  return createShareLink(`/api/compartir/reporte/${kind}`,
    { t: "report", k: kind, f: dated ? f.desde : null, to: dated ? f.hasta : null, u: user.id }, REPORT_SHARE_TTL_MS);
}

export async function logReportWhatsApp(user: CurrentUser, kind: ReportKind, f: ReportFilters, input: { phone: string | null; channel: "link" | "file" }) {
  assertCan(user, "reports.export");
  await audit({ userId: user.id, action: "report.whatsapp", entity: "Report",
    data: { tipo: kind, desde: f.desde, hasta: f.hasta, phone: input.phone, channel: input.channel } });
}

/** CSV de un enlace público; null si el enlace es inválido/vencido o quien lo compartió ya no tiene permiso. */
export async function loadSharedReport(token: string | null, kind: string) {
  const p = readShareToken(token);
  if (!p || p.t !== "report" || p.k !== kind || !isReportKind(kind)) return null;
  const user = await loadShareUser(p.u);
  if (!user || !user.permissions.has("reports.export")) return null;
  const { from, to } = resolveRange(p.f, p.to);
  const out = await buildReport(user, kind, from, to);
  await audit({ userId: user.id, action: "report.share_download", entity: "Report",
    data: { tipo: kind, from: from.toISOString(), to: to.toISOString() } });
  return out;
}
