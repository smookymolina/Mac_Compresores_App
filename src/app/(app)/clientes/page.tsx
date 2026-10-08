import Link from "next/link";
import { Users } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { pageCustomers } from "@/modules/customers/service";
import { Card, DataTable, EmptyState, LinkButton, PageHeader, Pager, type DataColumn, FilteredEmpty, SearchInput } from "@/components/ui";
import { sp } from "@/lib/utils";

export const metadata = { title: "Clientes" };

const COLUMNS: DataColumn[] = [
  { id: "name", header: "Razón social", sortable: true },
  { id: "rfc", header: "RFC", sortable: true, cellClass: "mono" },
  { id: "owner", header: "Vendedor", sortable: true },
  { id: "terms", header: "Crédito (días)", align: "right", sortable: true },
  { id: "quotes", header: "Cotizaciones", align: "right", sortable: true },
  { id: "sales", header: "Ventas", align: "right", sortable: true },
];

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requirePagePermission("customers.read");
  const { q, page: pageParam } = await searchParams;
  const { items: rows, total, page, pages } = await pageCustomers(user, { search: sp(q), page: Number(pageParam) || 1 });
  const qs = (n: number) => `?${new URLSearchParams({ ...(q && { q }), page: String(n) })}`;
  const canWrite = can(user, "customers.write");

  return (
    <>
      <PageHeader title="Clientes" subtitle={`${total.toLocaleString("es-MX")} clientes`} actions={canWrite && <LinkButton href="/clientes/nuevo">Nuevo cliente</LinkButton>} />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <SearchInput name="q" defaultValue={q} placeholder="Razón social o RFC" aria-label="Buscar por razón social o RFC" />
          <button className="btn btn-secondary">Buscar</button>
        </form>
        <DataTable
          caption="Clientes"
          columns={COLUMNS}
          empty={q ? <FilteredEmpty clearHref="/clientes" /> : <EmptyState icon={Users} title="Sin clientes" action={canWrite && <LinkButton href="/clientes/nuevo" variant="secondary">Nuevo cliente</LinkButton>}>Registra un cliente para cotizarle y venderle.</EmptyState>}
          rows={rows.map((c) => ({
            id: c.id,
            cells: [
              <Link key="n" className="font-medium text-accent-fg hover:underline" href={`/clientes/${c.id}`}>{c.legalName}</Link>,
              c.rfc ?? "—", c.owner?.name ?? "Sin asignar", c.paymentTermsDays, c._count.quotes, c._count.sales,
            ],
            sort: [c.legalName, c.rfc, c.owner?.name ?? "", c.paymentTermsDays, c._count.quotes, c._count.sales],
          }))}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="clientes" href={qs} />}
      </Card>
    </>
  );
}
