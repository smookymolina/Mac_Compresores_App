import Link from "next/link";
import { Package } from "lucide-react";
import type { Prisma, ProductLine, ProductStatus } from "@prisma/client";
import { can, requirePagePermission } from "@/lib/auth/session";
import { currentExchangeRate, listProducts } from "@/modules/products/service";
import { setExchangeRateAction } from "@/modules/products/actions";
import { ActionForm } from "@/components/action-form";
import { LINE_LABEL, LINES } from "@/modules/products/lines";
import { Badge, Card, DataTable, EmptyState, Field, LinkButton, PageHeader, Pager, type DataColumn, FilteredEmpty, SearchInput } from "@/components/ui";
import { fmtMoney, fmtPct } from "@/lib/money";
import { fmtDate, sp } from "@/lib/utils";

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
  const canQuote = can(user, "quotes.write");
  const fx = await currentExchangeRate();
  const money = (v: Prisma.Decimal, cur: string) => (cur === "USD" ? `USD ${v.toFixed(2)}` : fmtMoney(v));
  const columns: DataColumn[] = [
    { id: "sku", header: "SKU", sortable: true, cellClass: "whitespace-nowrap" },
    { id: "description", header: "Descripción", sortable: true, cellClass: "min-w-56" },
    { id: "line", header: "Línea", sortable: true, cellClass: "text-xs whitespace-nowrap" },
    { id: "unit", header: "Unidad", sortable: true },
    ...(showCost ? [{ id: "cost", header: "Costo", align: "right", sortable: true } satisfies DataColumn] : []),
    { id: "price", header: "Precio", align: "right", sortable: true },
    { id: "tax", header: "IVA", align: "right", sortable: true },
    { id: "status", header: "Estado", sortable: true },
    ...(canQuote ? [{ id: "quote", header: "Cotizar" } satisfies DataColumn] : []),
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
            {can(user, "products.write") && <LinkButton variant="secondary" href="/productos/complementos">Complementos</LinkButton>}
            {can(user, "products.write") && <LinkButton href="/productos/nuevo">Nuevo producto</LinkButton>}
          </>
        }
      />
      <Card className="mb-4 flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="text-sm">
          <div className="font-medium">Tipo de cambio USD → MXN</div>
          <div className="text-ink-soft">
            {fx ? <>Vigente: <b className="tabular-nums">${fx.rate.toFixed(4)}</b> · {fmtDate(fx.createdAt)}</> : "Sin capturar: los productos en USD (tubería) no se pueden cotizar."}
          </div>
        </div>
        {showCost && (
          <ActionForm action={setExchangeRateAction} submitLabel="Actualizar TC" size="sm" className="flex flex-wrap items-end gap-2">
            <Field label="Nuevo TC" name="rate" inputMode="decimal" required className="w-32" />
          </ActionForm>
        )}
      </Card>
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
        <DataTable mobileCards
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
              ...(showCost ? [money(r.cost, r.currency)] : []),
              r.price.isZero() ? <Badge key="p" tone="amber">Sin precio</Badge> : money(r.price, r.currency),
              fmtPct(r.taxRate),
              r.status === "ACTIVE" ? <Badge key="e" tone="green">Activo</Badge> : <Badge key="e">Inactivo</Badge>,
              ...(canQuote ? [r.status === "ACTIVE" && !r.price.isZero()
                ? <Link key="q" className="text-accent-fg hover:underline" href={`/cotizaciones/nueva?producto=${r.id}`}>Cotizar</Link> : ""] : []),
            ],
            // Orden solo sobre la página cargada; el catálogo completo se recorre con los filtros y la paginación.
            sort: [r.sku, r.description, r.line, r.unit, ...(showCost ? [r.cost.toNumber()] : []), r.price.toNumber(), r.taxRate.toNumber(), r.status],
          }))}
        />
        <Pager page={page} pages={pages} total={total} noun="productos" href={qs} />
      </Card>
    </>
  );
}
