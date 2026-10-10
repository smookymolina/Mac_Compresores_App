import Link from "next/link";
import { AlertTriangle, Banknote, FileText, HandCoins, Receipt, Target } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { getDashboard } from "@/modules/dashboard/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { Card, CardHeader, EmptyState, DataTable, MonthBars, PageHeader, Stat, StatGroup } from "@/components/ui";
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
        {d.salesMonth && <Stat icon={Banknote} label="Venta neta del mes (sin IVA)" value={fmtMoney(d.salesMonth.net)} hint={`${d.salesMonth.count} ventas confirmadas`} href="/ventas" />}
        {d.salesMonth && <Stat icon={Receipt} label="Ventas del mes (con IVA)" value={fmtMoney(d.salesMonth.total)} />}
        {d.openQuotes && <Stat icon={FileText} label="Cotizaciones abiertas" value={d.openQuotes.count} hint={`${fmtMoney(d.openQuotes.total)} en proceso`} href="/cotizaciones" />}
        {d.receivables && (
          <Stat icon={HandCoins} label="Por cobrar" value={fmtMoney(d.receivables.pending)}
            tone={d.receivables.overdueCount > 0 ? "red" : undefined}
            href={d.receivables.overdueCount > 0 ? "/cobranza?vencidas=1" : "/cobranza"}
            hint={d.receivables.overdueCount > 0 ? `${fmtMoney(d.receivables.overdue)} vencido (${d.receivables.overdueCount})` : "Sin saldos vencidos"} />
        )}
        {d.conversion && (
          <Stat icon={Target} label="Conversión (90 días)" value={d.conversion.rate === null ? "—" : `${Math.round(d.conversion.rate * 100)} %`}
            hint={d.conversion.decided > 0 ? `${d.conversion.won} de ${d.conversion.decided} cotizaciones resueltas` : "Aún sin cotizaciones resueltas"} />
        )}
        {d.lowStock !== null && <Stat icon={AlertTriangle} label="Productos bajo mínimo" value={d.lowStock} tone={d.lowStock > 0 ? "red" : undefined} hint="Existencia ≤ stock mínimo" href="/inventario?low=1" />}
      </StatGroup>

      <div className="stagger mt-4 grid gap-4 lg:grid-cols-2">
        {d.monthly && (
          <Card className="lg:col-span-2">
            <CardHeader title="Venta neta por mes" description="Últimos 12 meses, sin IVA" />
            <div className="p-4"><MonthBars data={d.monthly} caption="Venta neta por mes, últimos 12 meses" /></div>
          </Card>
        )}

        {d.targets && (
          <Card className="lg:col-span-2">
            <CardHeader title={`Metas · ${d.targets.period}`} description="Venta neta del periodo de comisiones contra la meta de cada vendedor" />
            <ul className="space-y-3 p-4 text-sm">
              {d.targets.rows.map((t, i) => {
                const pct = t.target.gt(0) ? t.actual.div(t.target).toNumber() : 0;
                return (
                  <li key={t.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(5rem,10rem)_1fr_minmax(7rem,12rem)]">
                    <span className="truncate">{t.name}</span>
                    <span className="goal-track order-last col-span-2 sm:order-none sm:col-span-1" role="img" aria-label={`${Math.round(pct * 100)} % de la meta`}>
                      <span className={`goal-fill bar-fill${pct >= 1 ? " is-met" : ""}`} style={{ width: `${Math.min(pct, 1) * 100}%`, "--i": i } as React.CSSProperties} />
                    </span>
                    <span className="num text-xs"><b className="text-sm">{Math.round(pct * 100)} %</b> · {fmtMoney(t.actual)} / {fmtMoney(t.target)}</span>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        {d.recentSales.length > 0 || d.salesMonth ? (
          <Card className="overflow-hidden">
            <CardHeader title="Últimas ventas" actions={<Link href="/ventas" className="text-sm text-accent-fg hover:underline">Ver todas</Link>} />
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
                <li key={q.status}>
                  <Link href={`/cotizaciones?status=${q.status}`} className="row-hover flex justify-between px-4 py-2 hover:text-accent-fg">
                    <span>{QUOTE_STATUS_LABEL[q.status]}</span>
                    <span className="font-medium tabular-nums">{q.count}</span>
                  </Link>
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
                <li key={s.name} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(5rem,10rem)_1fr_minmax(5.5rem,8rem)]">
                  <span className="truncate">{s.name}</span>
                  <span className="order-last col-span-2 h-2 overflow-hidden rounded-full bg-line sm:order-none sm:col-span-1">
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
