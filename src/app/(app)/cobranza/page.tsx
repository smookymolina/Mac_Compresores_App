import Link from "next/link";
import { AlarmClock, HandCoins, Wallet } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listReceivables } from "@/modules/payments/service";
import { Badge, Card, DataTable, EmptyState, PageHeader, Stat, StatGroup, type DataColumn } from "@/components/ui";
import { dec, fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

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

export default async function ReceivablesPage({ searchParams }: { searchParams: Promise<{ vencidas?: string }> }) {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const { vencidas } = await searchParams;
  const all = await listReceivables(user);
  const rows = vencidas ? all.filter((r) => r.overdue) : all;
  const pending = all.reduce((a, r) => a.add(r.balance), dec(0));
  const overdue = all.filter((r) => r.overdue);
  const overdueAmt = overdue.reduce((a, r) => a.add(r.balance), dec(0));

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
          columns={COLUMNS}
          empty={<EmptyState icon={HandCoins} title={vencidas ? "Sin saldos vencidos" : "Todo cobrado"}>No hay ventas con saldo pendiente.</EmptyState>}
          rows={rows.map((r) => ({
            id: r.id,
            cells: [
              <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/ventas/${r.id}`}>V-{r.folio}</Link>,
              r.customer, fmtDate(r.confirmedAt), fmtDate(r.due),
              r.overdue ? <Badge key="b" tone="red">Vencida</Badge> : <Badge key="b" tone="amber">Por cobrar</Badge>,
              fmtMoney(r.total), fmtMoney(r.balance),
            ],
            sort: [r.folio, r.customer, r.confirmedAt.getTime(), r.due.getTime(), r.overdue ? 1 : 0, r.total.toNumber(), r.balance.toNumber()],
          }))}
        />
      </Card>
    </>
  );
}
