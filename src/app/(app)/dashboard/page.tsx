import Link from "next/link";
import { AlertTriangle, Banknote, FileText, HandCoins, Receipt, Target } from "lucide-react";
import { redirect } from "next/navigation";
import { can, homePath, requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { uuid } from "@/lib/validation";
import { asSeller, getDashboard } from "@/modules/dashboard/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { Card, CardHeader, EmptyState, DataTable, MonthBars, PageHeader, Stat, StatGroup } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { getUsage } from "@/modules/dashboard/usage";
import { actionLabel } from "@/modules/audit/labels";

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

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string; vendedor?: string }> }) {
  const user = await requireUser();
  if (!can(user, "dashboard.read")) redirect(homePath(user));
  const { denied, vendedor } = await searchParams;
  // Quien ve todo (administración) puede consultar las métricas de un vendedor en particular.
  const sellers = can(user, "sales.read_all")
    ? await db.user.findMany({ where: { active: true, role: { code: { in: ["VENTAS", "GERENCIA", "ADMIN"] } } }, select: { id: true, name: true }, orderBy: { name: "asc" } })
    : [];
  const seller = vendedor && uuid.safeParse(vendedor).success ? sellers.find((s) => s.id === vendedor) : undefined;
  const d = await getDashboard(seller ? asSeller(user, seller) : user);
  const now = new Date();
  const maxSeller = Math.max(1, ...d.bySeller.map((s) => s.net.toNumber()));

  return (
    <>
      <PageHeader
        gauge
        eyebrow={monthLabel(now)}
        title={`${greeting(now)}, ${user.name.split(" ")[0]}`}
        subtitle={seller ? `Métricas de ${seller.name} en el mes en curso.` : can(user, "sales.read_all") ? "Resumen del mes en curso de todo el equipo." : "Tus métricas del mes en curso."}
      />
      {sellers.length > 0 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label className="text-sm text-ink-soft">Ver métricas de
            <select name="vendedor" defaultValue={seller?.id ?? ""} className="input mt-1 min-w-56">
              <option value="">Todo el equipo</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button className="btn btn-secondary">Ver</button>
        </form>
      )}
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
            <CardHeader title="Últimas ventas" actions={<Link href="/ventas" className="inline-flex min-h-11 items-center text-sm text-accent-fg hover:underline sm:min-h-0">Ver todas</Link>} />
            {d.recentSales.length === 0 ? (
              <EmptyState title="Sin ventas registradas">Las ventas confirmadas del mes aparecerán aquí.</EmptyState>
            ) : (
              <DataTable
                caption="Últimas ventas"
                columns={[
                  { id: "folio", header: "Folio" },
                  { id: "cliente", header: "Cliente", cellClass: "min-w-40 break-words" },
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
                  <Link href={`/cotizaciones?status=${q.status}`} className="row-hover flex min-h-11 items-center justify-between gap-3 px-4 py-2 hover:text-accent-fg sm:min-h-0">
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
      {can(user, "users.manage") && <UsageSection />}
    </>
  );
}

/** Solo admin: actividad de cada usuario en los últimos 30 días. */
async function UsageSection() {
  const rows = await getUsage(30);
  const ago = (d: Date | null) => {
    if (!d) return "Nunca";
    const m = Math.round((Date.now() - d.getTime()) / 60_000);
    return m < 60 ? `Hace ${Math.max(m, 1)} min` : m < 1440 ? `Hace ${Math.round(m / 60)} h` : `Hace ${Math.round(m / 1440)} d`;
  };
  return (
    <Card className="mt-4 p-0">
      <details>
        <summary className="tap flex cursor-pointer flex-wrap items-baseline justify-between gap-2 p-4">
          <span className="font-semibold">Uso de la app por usuario</span>
          <span className="text-xs text-ink-soft">Últimos 30 días · {rows.filter((r) => r.activeDays > 0).length} de {rows.length} usuarios activos</span>
        </summary>
        <div className="border-t border-line">
          <DataTable
            mobileCards
            caption="Uso de la app por usuario, últimos 30 días"
            columns={[
              { id: "user", header: "Usuario", sortable: true },
              { id: "last", header: "Última actividad", sortable: true },
              { id: "days", header: "Días activos", align: "right", sortable: true },
              { id: "logins", header: "Inicios de sesión", align: "right", sortable: true },
              { id: "actions", header: "Acciones", align: "right", sortable: true },
              { id: "quotes", header: "Cotizaciones", align: "right", sortable: true },
              { id: "sales", header: "Ventas", align: "right", sortable: true },
              { id: "top", header: "Lo que más hace" },
            ]}
            rows={rows.map((u) => ({
              id: u.id,
              sort: [u.name, u.lastSeenAt?.getTime() ?? 0, u.activeDays, u.logins, u.actions, u.quotes, u.sales, null],
              cells: [
                <span key="u" className="break-words"><b>{u.name}</b><span className="block text-xs text-ink-soft">{u.role}{!u.active && " · inactivo"}</span></span>,
                <span key="l" title={u.lastSeenAt ? fmtDateTime(u.lastSeenAt) : undefined}>{ago(u.lastSeenAt)}</span>,
                <span key="d" className="num">{u.activeDays}</span>,
                <span key="g" className="num">{u.logins}</span>,
                <span key="a" className="num">{u.actions}</span>,
                <span key="q" className="num">{u.quotes}</span>,
                <span key="s" className="num">{u.sales}</span>,
                <span key="t" className="text-xs">{u.topAction ? actionLabel(u.topAction) : "—"}</span>,
              ],
            }))}
          />
        </div>
      </details>
    </Card>
  );
}
