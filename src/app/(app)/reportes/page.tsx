import { Download } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { isMailConfigured } from "@/lib/mail";
import { shareUnavailableReason } from "@/lib/share";
import { REPORTS, type ReportKind } from "@/modules/reports/service";
import { emailReportAction, logReportWhatsAppAction, shareReportLinkAction } from "@/modules/reports/actions";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SendDialog } from "@/components/ui/send-dialog";

export const metadata = { title: "Reportes" };

export default async function ReportsPage() {
  const user = await requirePagePermission("reports.export");
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  const mailUnavailable = isMailConfigured() ? null : "El envío de correos no está configurado. Contacta al administrador.";
  const linkUnavailable = shareUnavailableReason();
  return (
    <>
      <PageHeader title="Reportes" subtitle="Descarga en CSV (se abre directo en Excel) o envíalo por correo o WhatsApp. Las fechas son inclusivas; por omisión, el mes en curso." />
      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(Object.entries(REPORTS) as [ReportKind, (typeof REPORTS)[ReportKind]][]).map(([kind, r]) => {
          const period = r.dated ? " del {desde} al {hasta}" : "";
          return (
            <Card key={kind}>
              <CardHeader title={r.title} description={r.description} />
              <form action={`/api/reportes/${kind}`} method="get" className="grid grid-cols-2 items-end gap-3 p-4">
                {r.dated && (
                  <>
                    <div className="min-w-0">
                      <label htmlFor={`${kind}-desde`} className="label">Desde</label>
                      <input id={`${kind}-desde`} name="desde" type="date" defaultValue={first} required className="input" />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor={`${kind}-hasta`} className="label">Hasta</label>
                      <input id={`${kind}-hasta`} name="hasta" type="date" defaultValue={today} required className="input" />
                    </div>
                  </>
                )}
                <div className="col-span-2 flex flex-wrap gap-2">
                  <button className="btn btn-secondary"><Download size={16} strokeWidth={1.75} aria-hidden /> Descargar CSV</button>
                  <SendDialog
                    triggerLabel="Enviar"
                    title={`Enviar reporte: ${r.title}`}
                    docName={r.title}
                    paramsFromForm
                    file={{ url: `/api/reportes/${kind}`, filename: `${kind}.csv`, type: "text/csv" }}
                    email={{
                      action: emailReportAction.bind(null, kind),
                      unavailable: mailUnavailable,
                      defaultMessage: `Hola:\n\nTe comparto el reporte «${r.title}»${period} en CSV (se abre directo en Excel).\n\nSaludos.`,
                      note: `Se adjunta el CSV; las respuestas llegan a ${user.email}.`,
                    }}
                    whatsapp={{
                      linkAction: shareReportLinkAction.bind(null, kind),
                      logAction: logReportWhatsAppAction.bind(null, kind),
                      unavailable: linkUnavailable,
                      defaultMessage: `Hola, te comparto el reporte «${r.title}»${period} de MAC Compresores. Descárgalo aquí:`,
                      note: "Cualquiera con el enlace puede descargar el reporte.",
                    }}
                  />
                </div>
              </form>
            </Card>
          );
        })}
      </div>
    </>
  );
}
