import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { listSales } from "@/modules/sales/service";
import { Badge, Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Ventas" };

export default async function SalesPage() {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const rows = await listSales(user);
  return (
    <>
      <PageHeader title="Ventas" subtitle="Se generan al convertir una cotización aceptada." />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title="Sin ventas">Convierte una cotización aceptada para registrar la primera venta.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Folio</th><th>Cotización</th><th>Cliente</th><th>Vendedor</th><th>Fecha</th><th>Estado</th><th className="num">Total</th></tr></thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td><Link className="text-brand hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link></td>
                    <td>C-{s.quote.folio}</td>
                    <td>{s.customer.legalName}</td>
                    <td>{s.seller.name}</td>
                    <td>{fmtDate(s.confirmedAt)}</td>
                    <td>{s.status === "CONFIRMED" ? <Badge tone="green">Confirmada</Badge> : <Badge tone="red">Cancelada</Badge>}</td>
                    <td className="num">{fmtMoney(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
