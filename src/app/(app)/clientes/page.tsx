import Link from "next/link";
import { Users } from "lucide-react";
import { can, requirePagePermission } from "@/lib/auth/session";
import { pageCustomers } from "@/modules/customers/service";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, Pager, type DataColumn, FilteredEmpty, SearchInput } from "@/components/ui";
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

const STATUS = { active: "Activos", inactive: "Inactivos", all: "Todos" } as const;
type Status = keyof typeof STATUS;

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string; estado?: string }> }) {
  const user = await requirePagePermission("customers.read");
  const { q, page: pageParam, estado } = await searchParams;
  const status: Status = estado === "inactive" || estado === "all" ? estado : "active";
  const { items: rows, total, page, pages } = await pageCustomers(user, { search: sp(q), page: Number(pageParam) || 1, status });
  const qs = (n: number) => `?${new URLSearchParams({ ...(q && { q }), ...(status !== "active" && { estado: status }), page: String(n) })}`;
  const filtered = Boolean(q) || status !== "active";
  const canWrite = can(user, "customers.write");

  return (
    <>
      <PageHeader title="Clientes" subtitle={`${total.toLocaleString("es-MX")} clientes${status === "active" ? " activos" : status === "inactive" ? " inactivos" : ""}`} actions={canWrite && <LinkButton href="/clientes/nuevo">Nuevo cliente</LinkButton>} />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <SearchInput name="q" defaultValue={q} placeholder="Razón social o RFC" aria-label="Buscar por razón social o RFC" />
          <select name="estado" aria-label="Estado del cliente" defaultValue={status} className="input">
            {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn btn-secondary">Buscar</button>
        </form>
        <DataTable
          caption="Clientes"
          columns={COLUMNS}
          empty={filtered ? <FilteredEmpty clearHref="/clientes" /> : <EmptyState icon={Users} title="Sin clientes" action={canWrite && <LinkButton href="/clientes/nuevo" variant="secondary">Nuevo cliente</LinkButton>}>Registra un cliente para cotizarle y venderle.</EmptyState>}
          rows={rows.map((c) => ({
            id: c.id,
            cells: [
              <span key="n" className="inline-flex flex-wrap items-center gap-2">
                <Link className="font-medium text-accent-fg hover:underline" href={`/clientes/${c.id}`}>{c.legalName}</Link>
                {!c.active && <Badge>Inactivo</Badge>}
              </span>,
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
