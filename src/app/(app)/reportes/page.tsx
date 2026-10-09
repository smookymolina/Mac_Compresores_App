import { Download } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { REPORTS } from "@/modules/reports/service";
import { Card, CardHeader, PageHeader } from "@/components/ui";

export const metadata = { title: "Reportes" };

export default async function ReportsPage() {
  await requirePagePermission("reports.export");
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const today = now.toISOString().slice(0, 10);
  return (
    <>
      <PageHeader title="Reportes" subtitle="Descarga en CSV (se abre directo en Excel). Las fechas son inclusivas; por omisión, el mes en curso." />
      <div className="stagger grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(REPORTS).map(([kind, r]) => (
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
              <button className="btn btn-secondary col-span-2 justify-self-start"><Download size={16} strokeWidth={1.75} aria-hidden /> Descargar CSV</button>
            </form>
          </Card>
        ))}
      </div>
    </>
  );
}
