"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError, runAction, type ActionResult } from "@/lib/errors";
import { normalizePhone } from "@/modules/quotes/phone";
import { isReportKind, type ReportKind } from "./service";
import { emailReport, logReportWhatsApp, shareReportLink, type ReportFilters } from "./send";

const day = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida").nullable();

function parseKind(kind: string): ReportKind {
  if (!isReportKind(kind)) throw new AppError("Reporte no encontrado.", "NOT_FOUND");
  return kind;
}

function filters(fd: FormData): ReportFilters {
  const v = (k: string) => {
    const x = fd.get(k);
    return typeof x === "string" && x.trim() ? x.trim() : null;
  };
  return { desde: day.parse(v("desde")), hasta: day.parse(v("hasta")) };
}

const emailList = z.string().trim().max(500).transform((v) => v.split(/[,;\s]+/).filter(Boolean))
  .pipe(z.array(z.string().email("Correo inválido")).max(10));

export async function emailReportAction(kind: string, _: ActionResult<unknown> | null, fd: FormData) {
  return runAction(async () => {
    const user = await requirePermission("reports.export");
    const d = z.object({
      to: emailList.refine((v) => v.length > 0, "Indica al menos un correo"),
      cc: emailList,
      message: z.string().trim().min(1, "Escribe un mensaje").max(2000),
    }).parse({ to: fd.get("to"), cc: fd.get("cc") ?? "", message: fd.get("message") });
    await emailReport(user, parseKind(kind), filters(fd), d);
  }, "Reporte enviado por correo.");
}

export async function shareReportLinkAction(kind: string, fd: FormData) {
  return runAction(async () => {
    const user = await requirePermission("reports.export");
    return shareReportLink(user, parseKind(kind), filters(fd));
  });
}

export async function logReportWhatsAppAction(kind: string, fd: FormData) {
  return runAction(async () => {
    const user = await requirePermission("reports.export");
    const d = z.object({
      phone: z.string().trim().max(30).optional().transform((v) => normalizePhone(v)),
      channel: z.enum(["link", "file"]),
    }).parse({ phone: fd.get("phone") ?? undefined, channel: fd.get("channel") });
    await logReportWhatsApp(user, parseKind(kind), filters(fd), d);
  });
}
