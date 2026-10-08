import Link from "next/link";
import { FileText } from "lucide-react";
import type { QuoteStatus } from "@prisma/client";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listQuotes } from "@/modules/quotes/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { Card, DataTable, EmptyState, LinkButton, PageHeader, Pager, type DataColumn, FilteredEmpty, SearchInput } from "@/components/ui";
import { QuoteStatusBadge } from "./status-badge";
import { fmtMoney } from "@/lib/money";
import { fmtDate, sp } from "@/lib/utils";

export const metadata = { title: "Cotizaciones" };

const COLUMNS: DataColumn[] = [
  { id: "folio", header: "Folio", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "customer", header: "Cliente", sortable: true },
  { id: "seller", header: "Vendedor", sortable: true },
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "valid", header: "Vigencia", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "status", header: "Estado", sortable: true },
  { id: "total", header: "Total", align: "right", sortable: true },
];

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const user = await requirePagePermission("quotes.read_all", "quotes.read_own");
  const p = await searchParams;
  const status = p.status && p.status in QUOTE_STATUS_LABEL ? (p.status as QuoteStatus) : undefined;
  const { items: rows, total, page, pages } = await listQuotes(user, { status, search: sp(p.q), page: Number(p.page) || 1 });
  const qs = (n: number) => `?${new URLSearchParams({ ...(p.q && { q: p.q }), ...(status && { status }), page: String(n) })}`;
  const canWrite = can(user, "quotes.write");

  return (
    <>
      <PageHeader title="Cotizaciones" subtitle={`${total.toLocaleString("es-MX")} cotizaciones`} actions={canWrite && <LinkButton href="/cotizaciones/nueva">Nueva cotización</LinkButton>} />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <SearchInput name="q" defaultValue={p.q} placeholder="Folio o cliente" aria-label="Buscar por folio o cliente" />
          <select name="status" defaultValue={status ?? ""} aria-label="Estado" className="input">
            <option value="">Todos los estados</option>
            {Object.entries(QUOTE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="btn btn-secondary">Filtrar</button>
        </form>
        <DataTable
          caption="Cotizaciones"
          columns={COLUMNS}
          empty={p.q || status ? <FilteredEmpty clearHref="/cotizaciones" /> : <EmptyState icon={FileText} title="Sin cotizaciones" action={canWrite && <LinkButton href="/cotizaciones/nueva" variant="secondary">Nueva cotización</LinkButton>}>Crea una cotización con precios del catálogo y conviértela en venta.</EmptyState>}
          rows={rows.map((q) => ({
            id: q.id,
            cells: [
              <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/cotizaciones/${q.id}`}>C-{q.folio}</Link>,
              q.customer.legalName, q.seller.name, fmtDate(q.createdAt), fmtDate(q.validUntil),
              <QuoteStatusBadge key="s" status={q.status} />, fmtMoney(q.total),
            ],
            // Valores comparables solo para ordenar en pantalla.
            sort: [q.folio, q.customer.legalName, q.seller.name, q.createdAt.getTime(), q.validUntil.getTime(), QUOTE_STATUS_LABEL[q.status], q.total.toNumber()],
          }))}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="cotizaciones" href={qs} />}
      </Card>
    </>
  );
}
