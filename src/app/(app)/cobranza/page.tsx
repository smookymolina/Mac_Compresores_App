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
        <div className="toolbar">
          <Link href="/cobranza" className={`btn ${vencidas ? "btn-ghost" : "btn-secondary"}`}>Todas</Link>
          <Link href="/cobranza?vencidas=1" className={`btn ${vencidas ? "btn-secondary" : "btn-ghost"}`}>Solo vencidas</Link>
        </div>
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
      </Card>
    </>
  );
}
