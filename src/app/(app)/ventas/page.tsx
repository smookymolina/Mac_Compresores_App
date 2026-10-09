import Link from "next/link";
import { Receipt } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { listSales } from "@/modules/sales/service";
import { paidBySale } from "@/modules/payments/service";
import { Badge, Card, DataTable, EmptyState, FilteredEmpty, PageHeader, Pager, SearchInput, type DataColumn } from "@/components/ui";
import { dec, fmtMoney } from "@/lib/money";
import { fmtDate, sp } from "@/lib/utils";

export const metadata = { title: "Ventas" };

const COLUMNS: DataColumn[] = [
  { id: "folio", header: "Folio", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "quote", header: "Cotización", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "customer", header: "Cliente", sortable: true },
  { id: "seller", header: "Vendedor", sortable: true },
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "status", header: "Estado", sortable: true },
  { id: "total", header: "Total", align: "right", sortable: true },
  { id: "balance", header: "Saldo", align: "right", sortable: true },
];

const STATUS_LABEL = { CONFIRMED: "Confirmada", CANCELLED: "Cancelada" } as const;

export default async function SalesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const p = await searchParams;
  const status = p.status && p.status in STATUS_LABEL ? (p.status as keyof typeof STATUS_LABEL) : undefined;
  const { items: rows, total, page, pages } = await listSales(user, { search: sp(p.q), status, page: Number(p.page) || 1 });
  const paid = await paidBySale(rows.map((r) => r.id));
  const balanceOf = (s: (typeof rows)[number]) => (s.status === "CONFIRMED" ? s.total.sub(paid.get(s.id) ?? dec(0)) : dec(0));
  const qs = (n: number) => `?${new URLSearchParams({ ...(p.q && { q: p.q }), ...(status && { status }), page: String(n) })}`;
  return (
    <>
      <PageHeader title="Ventas" subtitle={`${total.toLocaleString("es-MX")} ventas · se generan al convertir una cotización aceptada.`} />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <SearchInput name="q" defaultValue={p.q} placeholder="Folio o cliente" aria-label="Buscar por folio o cliente" />
          <select name="status" defaultValue={status ?? ""} aria-label="Estado" className="input">
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-secondary">Filtrar</button>
        </form>
        <DataTable
          caption="Ventas"
          columns={COLUMNS}
          empty={p.q || status ? <FilteredEmpty clearHref="/ventas" /> : <EmptyState icon={Receipt} title="Sin ventas">Convierte una cotización aceptada para registrar la primera venta.</EmptyState>}
          rows={rows.map((s) => ({
            id: s.id,
            cells: [
              <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link>,
              `C-${s.quote.folio}`, s.customer.legalName, s.seller.name, fmtDate(s.confirmedAt),
              s.status === "CONFIRMED" ? <Badge key="b" tone="green">Confirmada</Badge> : <Badge key="b" tone="red">Cancelada</Badge>,
              fmtMoney(s.total),
              s.status !== "CONFIRMED" ? "—" : balanceOf(s).lte(0) ? <span key="s" className="text-ok">Pagada</span> : fmtMoney(balanceOf(s)),
            ],
            sort: [s.folio, s.quote.folio, s.customer.legalName, s.seller.name, s.confirmedAt.getTime(), s.status, s.total.toNumber(), balanceOf(s).toNumber()],
          }))}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="ventas" href={qs} />}
      </Card>
    </>
  );
}
