import Link from "next/link";
import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import type { ProductLine, ProductStatus } from "@prisma/client";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listProducts } from "@/modules/products/service";
import { LINE_LABEL, LINES } from "@/modules/products/lines";
import { Badge, Card, DataTable, EmptyState, LinkButton, PageHeader, type DataColumn, FilteredEmpty, SearchInput } from "@/components/ui";
import { fmtMoney, fmtPct } from "@/lib/money";
import { sp } from "@/lib/utils";

export const metadata = { title: "Productos" };

type SP = Promise<Record<string, string | undefined>>;

export default async function ProductsPage({ searchParams }: { searchParams: SP }) {
  const user = await requirePagePermission("products.read");
  const p = await searchParams;
  const line = LINES.includes(p.line as ProductLine) ? (p.line as ProductLine) : undefined;
  const status = p.status === "ACTIVE" || p.status === "INACTIVE" ? (p.status as ProductStatus) : undefined;
  const page = Number(p.page) || 1;
  const { items, total, pages } = await listProducts({ search: sp(p.q), line, status, page });
  const showCost = can(user, "products.write");
  const columns: DataColumn[] = [
    { id: "sku", header: "SKU", sortable: true, cellClass: "whitespace-nowrap" },
    { id: "description", header: "Descripción", sortable: true },
    { id: "line", header: "Línea", sortable: true, cellClass: "text-xs" },
    { id: "unit", header: "Unidad", sortable: true },
    ...(showCost ? [{ id: "cost", header: "Costo", align: "right", sortable: true } satisfies DataColumn] : []),
    { id: "price", header: "Precio", align: "right", sortable: true },
    { id: "tax", header: "IVA", align: "right", sortable: true },
    { id: "status", header: "Estado", sortable: true },
  ];
  const qs = (n: number) =>
    `?${new URLSearchParams({ ...(p.q && { q: p.q }), ...(line && { line }), ...(status && { status }), page: String(n) })}`;

  return (
    <>
      <PageHeader
        title="Productos y precios"
        subtitle={`${total.toLocaleString("es-MX")} productos`}
        actions={
          <>
            {can(user, "products.import") && <LinkButton variant="secondary" href="/productos/importar">Importar CSV</LinkButton>}
            {can(user, "products.write") && <LinkButton href="/productos/nuevo">Nuevo producto</LinkButton>}
          </>
        }
      />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <SearchInput name="q" defaultValue={p.q} placeholder="SKU, descripción, no. de parte…" aria-label="Buscar producto" />
          <select name="line" aria-label="Línea" defaultValue={line ?? ""} className="input">
            <option value="">Todas las líneas</option>
            {LINES.map((l) => <option key={l} value={l}>{LINE_LABEL[l]}</option>)}
          </select>
          <select name="status" aria-label="Estado" defaultValue={status ?? ""} className="input">
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
          </select>
          <button className="btn btn-secondary">Filtrar</button>
        </form>
        <DataTable
          caption="Productos"
          columns={columns}
          empty={p.q || p.line || p.status ? <FilteredEmpty clearHref="/productos" /> : <EmptyState icon={Package} title="Sin productos">Da de alta un producto o importa la lista de precios.</EmptyState>}
          rows={items.map((r) => ({
            id: r.id,
            cells: [
              <Link key="s" className="mono font-medium text-accent-fg hover:underline" href={`/productos/${r.id}`}>{r.sku}</Link>,
              <span key="d">{r.description}<span className="block text-xs text-muted">{r.category?.name}</span></span>,
              LINE_LABEL[r.line].split(" (")[0],
              r.unit,
              ...(showCost ? [fmtMoney(r.cost)] : []),
              r.price.isZero() ? <Badge key="p" tone="amber">Sin precio</Badge> : fmtMoney(r.price),
              fmtPct(r.taxRate),
              r.status === "ACTIVE" ? <Badge key="e" tone="green">Activo</Badge> : <Badge key="e">Inactivo</Badge>,
            ],
            // Orden solo sobre la página cargada; el catálogo completo se recorre con los filtros y la paginación.
            sort: [r.sku, r.description, r.line, r.unit, ...(showCost ? [r.cost.toNumber()] : []), r.price.toNumber(), r.taxRate.toNumber(), r.status],
          }))}
        />
        <nav aria-label="Paginación" className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-sm text-ink-soft">
          <span className="tabular-nums">Página {page} de {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="btn btn-secondary btn-sm" href={qs(page - 1)}><ChevronLeft size={14} strokeWidth={1.75} aria-hidden /> Anterior</Link>}
            {page < pages && <Link className="btn btn-secondary btn-sm" href={qs(page + 1)}>Siguiente <ChevronRight size={14} strokeWidth={1.75} aria-hidden /></Link>}
          </span>
        </nav>
      </Card>
    </>
  );
}
