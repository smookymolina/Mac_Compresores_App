import Link from "next/link";
import { Receipt } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listSales } from "@/modules/sales/service";
import { Badge, Card, DataTable, EmptyState, PageHeader, type DataColumn } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Ventas" };

const COLUMNS: DataColumn[] = [
  { id: "folio", header: "Folio", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "quote", header: "Cotización", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "customer", header: "Cliente", sortable: true },
  { id: "seller", header: "Vendedor", sortable: true },
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "status", header: "Estado", sortable: true },
  { id: "total", header: "Total", align: "right", sortable: true },
];

export default async function SalesPage() {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const rows = await listSales(user);
  return (
    <>
      <PageHeader title="Ventas" subtitle="Se generan al convertir una cotización aceptada." />
      <Card className="overflow-hidden">
        <DataTable
          caption="Ventas"
          columns={COLUMNS}
          empty={<EmptyState icon={Receipt} title="Sin ventas">Convierte una cotización aceptada para registrar la primera venta.</EmptyState>}
          rows={rows.map((s) => ({
            id: s.id,
            cells: [
              <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link>,
              `C-${s.quote.folio}`, s.customer.legalName, s.seller.name, fmtDate(s.confirmedAt),
              s.status === "CONFIRMED" ? <Badge key="b" tone="green">Confirmada</Badge> : <Badge key="b" tone="red">Cancelada</Badge>,
              fmtMoney(s.total),
            ],
            sort: [s.folio, s.quote.folio, s.customer.legalName, s.seller.name, s.confirmedAt.getTime(), s.status, s.total.toNumber()],
          }))}
        />
      </Card>
    </>
  );
}
