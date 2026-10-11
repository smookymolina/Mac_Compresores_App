import Link from "next/link";
import { AlarmClock, HandCoins, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { isMailConfigured } from "@/lib/mail";
import { listReceivables } from "@/modules/payments/service";
import { reminderDraftsFor } from "@/modules/payments/reminder";
import { ReminderButton } from "@/components/payments/reminder-dialog";
import { Badge, Card, DataTable, EmptyState, PageHeader, Stat, StatGroup, type DataColumn } from "@/components/ui";
import { dec, fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/utils";

export const metadata = { title: "Cobranza" };

const COLUMNS: DataColumn[] = [
  { id: "folio", header: "Venta", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "customer", header: "Cliente", sortable: true },
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "due", header: "Vence", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "status", header: "Estado", sortable: true },
  { id: "total", header: "Total", align: "right", sortable: true },
  { id: "balance", header: "Saldo", align: "right", sortable: true },
];
const ACTIONS_COL: DataColumn = { id: "actions", header: "Acciones", align: "right", cellClass: "reminder-cell" };

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ vencidas?: string }> }) {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const { vencidas } = await searchParams;
  const all = await listReceivables(user);
  const rows = vencidas ? all.filter((r) => r.overdue) : all;
  const pending = all.reduce((a, r) => a.add(r.balance), dec(0));
  const overdue = all.filter((r) => r.overdue);
  const overdueAmt = overdue.reduce((a, r) => a.add(r.balance), dec(0));
  // Recordatorios por correo: solo quien registra pagos (mismo permiso que Cobranza/Pagos). Envío siempre manual.
  const canRemind = can(user, "payments.write");
  const drafts = canRemind ? await reminderDraftsFor(rows) : null;
  const mailOk = isMailConfigured();

  return (
    <>
      <PageHeader title="Cobranza" subtitle="Ventas confirmadas con saldo pendiente. El vencimiento usa los días de crédito del cliente." />
      <StatGroup className="mb-4">
        <Stat icon={Wallet} label="Por cobrar" value={fmtMoney(pending)} hint={`${all.length} ventas con saldo`} />
        <Stat icon={AlarmClock} label="Vencido" value={fmtMoney(overdueAmt)} tone={overdue.length > 0 ? "red" : undefined} hint={`${overdue.length} ventas vencidas`} />
      </StatGroup>
      <Card className="overflow-hidden">
        <nav className="toolbar flex-nowrap" aria-label="Filtro de cobranza">
          <Link href="/cobranza" aria-current={vencidas ? undefined : "page"} className={`btn max-md:!basis-0 ${vencidas ? "btn-ghost" : "btn-secondary"}`}>Todas</Link>
          <Link href="/cobranza?vencidas=1" aria-current={vencidas ? "page" : undefined} className={`btn max-md:!basis-0 ${vencidas ? "btn-secondary" : "btn-ghost"}`}>Solo vencidas</Link>
        </nav>
        {/* Móvil: tarjetas con saldo y recordatorio a la vista; la tabla queda para md+ */}
        {rows.length > 0 && (
          <ul className="divide-y divide-line md:hidden" aria-label="Cuentas por cobrar">
            {rows.map((r) => {
              const d = drafts?.get(r.id);
              return (
                <li key={r.id} className="space-y-2 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link className="inline-flex min-h-11 items-center font-medium text-accent-fg hover:underline" href={`/ventas/${r.id}`}>V-{r.folio}</Link>
                      <div className="break-words">{r.customer}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="num text-base font-semibold">{fmtMoney(r.balance)}</div>
                      <div className="num text-xs text-ink-soft">de {fmtMoney(r.total)}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
                    {r.overdue ? <Badge tone="red">Vencida</Badge> : <Badge tone="amber">Por cobrar</Badge>}
                    <span>Vence {fmtDate(r.due)}</span>
                    {d?.lastSentAt && <span>Recordatorio: {fmtDateTime(d.lastSentAt)}</span>}
                  </div>
                  {canRemind && d && (
                    <ReminderButton
                      saleId={r.id} folio={r.folio} customer={r.customer} balance={fmtMoney(r.balance)}
                      due={fmtDate(r.due)} replyTo={d.replyTo} to={d.to} message={d.message} lastSentAt={d.lastSentAt}
                      nextAllowedAt={d.nextAllowedAt} mailConfigured={mailOk} variant="button"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className={rows.length > 0 ? "hidden md:block" : undefined}>
        <DataTable
          caption="Cuentas por cobrar"
          columns={canRemind ? [...COLUMNS, ACTIONS_COL] : COLUMNS}
          empty={<EmptyState icon={HandCoins} title={vencidas ? "Sin saldos vencidos" : "Todo cobrado"}>No hay ventas con saldo pendiente.</EmptyState>}
          rows={rows.map((r) => {
            const d = drafts?.get(r.id);
            return {
              id: r.id,
              cells: [
                <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/ventas/${r.id}`}>V-{r.folio}</Link>,
                r.customer, fmtDate(r.confirmedAt), fmtDate(r.due),
                <div key="b" className="reminder-status">
                  {r.overdue ? <Badge tone="red">Vencida</Badge> : <Badge tone="amber">Por cobrar</Badge>}
                  {d?.lastSentAt && <span className="reminder-sent">Recordatorio: {fmtDateTime(d.lastSentAt)}</span>}
                </div>,
                fmtMoney(r.total), fmtMoney(r.balance),
                ...(canRemind ? [d ? (
                  <ReminderButton
                    key="r" saleId={r.id} folio={r.folio} customer={r.customer} balance={fmtMoney(r.balance)}
                    due={fmtDate(r.due)} replyTo={d.replyTo} to={d.to} message={d.message} lastSentAt={d.lastSentAt}
                    nextAllowedAt={d.nextAllowedAt} mailConfigured={mailOk}
                  />
                ) : ""] : []),
              ],
              sort: [r.folio, r.customer, r.confirmedAt.getTime(), r.due.getTime(), r.overdue ? 1 : 0, r.total.toNumber(), r.balance.toNumber()],
            };
          })}
        />
        </div>
      </Card>
    </>
  );
}
