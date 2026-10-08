import Link from "next/link";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listCustomers } from "@/modules/customers/service";
import { Card, EmptyState, LinkButton, PageHeader, TableWrap } from "@/components/ui";
import { sp } from "@/lib/utils";

export const metadata = { title: "Clientes" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePagePermission("customers.read");
  const { q } = await searchParams;
  const rows = await listCustomers(user, sp(q));

  return (
    <>
      <PageHeader
        title="Clientes"
        actions={can(user, "customers.write") && <LinkButton href="/clientes/nuevo">Nuevo cliente</LinkButton>}
      />
      <Card>
        <form className="flex gap-2 border-b border-line p-3">
          <input name="q" defaultValue={q} placeholder="Razón social o RFC" className="input max-w-xs" />
          <button className="rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50">Buscar</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="Sin clientes" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr><th>Razón social</th><th>RFC</th><th>Vendedor</th><th className="num">Crédito (días)</th><th className="num">Cotizaciones</th><th className="num">Ventas</th></tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><Link className="text-brand hover:underline" href={`/clientes/${c.id}`}>{c.legalName}</Link></td>
                    <td>{c.rfc ?? "—"}</td>
                    <td>{c.owner?.name ?? "Sin asignar"}</td>
                    <td className="num">{c.paymentTermsDays}</td>
                    <td className="num">{c._count.quotes}</td>
                    <td className="num">{c._count.sales}</td>
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
