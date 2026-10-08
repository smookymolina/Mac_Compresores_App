import Link from "next/link";
import { AlertTriangle, Banknote, FileText, Receipt } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { getDashboard } from "@/modules/dashboard/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { Card, CardHeader, EmptyState, PageHeader, Stat, TableWrap } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const user = await requirePagePermission("dashboard.read");
  const d = await getDashboard(user);
  const { denied } = await searchParams;
  const maxSeller = Math.max(1, ...d.bySeller.map((s) => s.net.toNumber()));

  return (
    <>
      <PageHeader title={`Hola, ${user.name}`} subtitle="Indicadores del mes en curso, calculados desde las operaciones registradas." />
      {denied && <p role="alert" className="mb-4 rounded-md border border-danger/20 bg-danger-soft px-3 py-2 text-sm text-danger">No tienes permiso para esa sección.</p>}
      <div className="stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {d.salesMonth && <Stat icon={Banknote} label="Venta neta del mes (sin IVA)" value={fmtMoney(d.salesMonth.net)} hint={`${d.salesMonth.count} ventas confirmadas`} />}
        {d.salesMonth && <Stat icon={Receipt} label="Ventas del mes (con IVA)" value={fmtMoney(d.salesMonth.total)} />}
        {d.openQuotes && <Stat icon={FileText} label="Cotizaciones abiertas" value={d.openQuotes.count} hint={`${fmtMoney(d.openQuotes.total)} en proceso`} />}
        {d.lowStock !== null && <Stat icon={AlertTriangle} label="Productos bajo mínimo" value={d.lowStock} tone={d.lowStock > 0 ? "red" : undefined} hint="Existencia ≤ stock mínimo" />}
      </div>

      <div className="stagger mt-4 grid gap-4 lg:grid-cols-2">
        {d.recentSales.length > 0 || d.salesMonth ? (
          <Card className="overflow-hidden">
            <CardHeader title="Últimas ventas" />
            {d.recentSales.length === 0 ? (
              <EmptyState title="Sin ventas registradas" />
            ) : (
              <TableWrap>
                <table className="table">
                  <tbody>
                    {d.recentSales.map((s) => (
                      <tr key={s.id}>
                        <td><Link className="font-medium text-accent-fg hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link></td>
                        <td>{s.customer.legalName}</td>
                        <td className="whitespace-nowrap text-ink-soft">{fmtDate(s.confirmedAt)}</td>
                        <td className="num">{fmtMoney(s.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        ) : null}

        {d.quotesByStatus.length > 0 && (
          <Card>
            <CardHeader title="Cotizaciones por estado" />
            <ul className="divide-y divide-line text-sm">
              {d.quotesByStatus.map((q) => (
                <li key={q.status} className="flex justify-between px-4 py-2">
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
              {d.bySeller.map((s) => (
                <li key={s.name} className="grid grid-cols-[minmax(5rem,10rem)_1fr_minmax(5.5rem,8rem)] items-center gap-3">
                  <span className="truncate">{s.name}</span>
                  <span className="h-2 overflow-hidden rounded-full bg-line">
                    <span className="block h-2 rounded-full bg-brand" style={{ width: `${(s.net.toNumber() / maxSeller) * 100}%` }} />
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
