import Link from "next/link";
import { AlertTriangle, Banknote, FileText, Receipt } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { getDashboard } from "@/modules/dashboard/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { Card, CardHeader, EmptyState, DataTable, PageHeader, Stat, StatGroup } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

// Hora y mes en la zona del negocio (el servidor puede correr en UTC).
const TZ = "America/Mexico_City";
function greeting(now: Date) {
  const h = Number(new Intl.DateTimeFormat("es-MX", { hour: "numeric", hourCycle: "h23", timeZone: TZ }).format(now));
  return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
}
const monthLabel = (now: Date) => {
  const m = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric", timeZone: TZ }).format(now);
  return m.charAt(0).toUpperCase() + m.slice(1);
};

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requirePagePermission("dashboard.read");
  const d = await getDashboard(user);
  const { denied } = await searchParams;
  const now = new Date();
  const maxSeller = Math.max(1, ...d.bySeller.map((s) => s.net.toNumber()));

  return (
    <>
      <PageHeader
        gauge
        eyebrow={monthLabel(now)}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}`}
        subtitle="Resumen del mes en curso, calculado desde las operaciones registradas."
      />
      {denied && <p role="alert" className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">No tienes permiso para esa sección.</p>}
      <StatGroup className="stagger">
        {d.salesMonth && <Stat icon={Banknote} label="Venta neta del mes (sin IVA)" value={fmtMoney(d.salesMonth.net)} hint={`${d.salesMonth.count} ventas confirmadas`} />}
        {d.salesMonth && <Stat icon={Receipt} label="Ventas del mes (con IVA)" value={fmtMoney(d.salesMonth.total)} />}
        {d.openQuotes && <Stat icon={FileText} label="Cotizaciones abiertas" value={d.openQuotes.count} hint={`${fmtMoney(d.openQuotes.total)} en proceso`} />}
        {d.lowStock !== null && <Stat icon={AlertTriangle} label="Productos bajo mínimo" value={d.lowStock} tone={d.lowStock > 0 ? "red" : undefined} hint="Existencia ≤ stock mínimo" />}
      </StatGroup>

      <div className="stagger mt-4 grid gap-4 lg:grid-cols-2">
        {d.recentSales.length > 0 || d.salesMonth ? (
          <Card className="overflow-hidden">
            <CardHeader title="Últimas ventas" />
            {d.recentSales.length === 0 ? (
              <EmptyState title="Sin ventas registradas">Las ventas confirmadas del mes aparecerán aquí.</EmptyState>
            ) : (
              <DataTable
                caption="Últimas ventas"
                columns={[
                  { id: "folio", header: "Folio" },
                  { id: "cliente", header: "Cliente" },
                  { id: "fecha", header: "Fecha", cellClass: "whitespace-nowrap text-ink-soft" },
                  { id: "total", header: "Total", align: "right" },
                ]}
                rows={d.recentSales.map((s) => ({
                  id: s.id,
                  cells: [
                    <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link>,
                    s.customer.legalName,
                    fmtDate(s.confirmedAt),
                    fmtMoney(s.total),
                  ],
                }))}
              />
            )}
          </Card>
        ) : null}

        {d.quotesByStatus.length > 0 && (
          <Card>
            <CardHeader title="Cotizaciones por estado" />
            <ul className="divide-y divide-line text-sm">
              {d.quotesByStatus.map((q) => (
                <li key={q.status} className="row-hover flex justify-between px-4 py-2">
                  <span>{QUOTE_STATUS_LABEL[q.status]}</span>
                  <span className="font-medium tabular-nums">{q.count}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {d.bySeller.length > 0 && (
          <Card className="lg:col-span-2">
            <CardHeader title="Venta neta del mes por vendedor" />
            <ul className="space-y-2 p-4 text-sm">
              {d.bySeller.map((s, i) => (
                <li key={s.name} className="grid grid-cols-[minmax(5rem,10rem)_1fr_minmax(5.5rem,8rem)] items-center gap-3">
                  <span className="truncate">{s.name}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-line">
                    <span className="bar-fill block h-2 rounded-full bg-brand" style={{ width: `${(s.net.toNumber() / maxSeller) * 100}%`, "--i": i } as React.CSSProperties} />
                  </span>
                  <span className="num">{fmtMoney(s.net)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}
