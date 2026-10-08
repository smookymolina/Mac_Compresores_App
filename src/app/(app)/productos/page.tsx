import Link from "next/link";
import type { ProductLine, ProductStatus } from "@prisma/client";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listProducts } from "@/modules/products/service";
import { LINE_LABEL, LINES } from "@/modules/products/lines";
import { Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap } from "@/components/ui";
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
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-line p-3">
          <input name="q" defaultValue={p.q} placeholder="SKU, descripción, no. de parte…" className="input max-w-xs" />
          <select name="line" defaultValue={line ?? ""} className="input max-w-56">
            <option value="">Todas las líneas</option>
            {LINES.map((l) => <option key={l} value={l}>{LINE_LABEL[l]}</option>)}
          </select>
          <select name="status" defaultValue={status ?? ""} className="input max-w-36">
            <option value="">Todos</option>
            <option value="ACTIVE">Activos</option>
            <option value="INACTIVE">Inactivos</option>
          </select>
          <button className="rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50">Filtrar</button>
        </form>
        {items.length === 0 ? (
          <EmptyState title="Sin productos">Ajusta los filtros o importa la lista de precios.</EmptyState>
        ) : (
          <TableWrap>
            <table className="table">
              <thead>
                <tr>
                  <th>SKU</th><th>Descripción</th><th>Línea</th><th>Unidad</th>
                  {showCost && <th className="num">Costo</th>}
                  <th className="num">Precio</th><th className="num">IVA</th><th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap"><Link className="text-brand hover:underline" href={`/productos/${r.id}`}>{r.sku}</Link></td>
                    <td>{r.description}<div className="text-xs text-ink-soft">{r.category?.name}</div></td>
                    <td className="text-xs">{LINE_LABEL[r.line].split(" (")[0]}</td>
                    <td>{r.unit}</td>
                    {showCost && <td className="num">{fmtMoney(r.cost)}</td>}
                    <td className="num">{r.price.isZero() ? <Badge tone="amber">Sin precio</Badge> : fmtMoney(r.price)}</td>
                    <td className="num">{fmtPct(r.taxRate)}</td>
                    <td>{r.status === "ACTIVE" ? <Badge tone="green">Activo</Badge> : <Badge>Inactivo</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        <div className="flex items-center justify-between p-3 text-sm text-ink-soft">
          <span>Página {page} de {pages}</span>
          <span className="flex gap-2">
            {page > 1 && <Link className="text-brand" href={qs(page - 1)}>← Anterior</Link>}
            {page < pages && <Link className="text-brand" href={qs(page + 1)}>Siguiente →</Link>}
          </span>
        </div>
      </Card>
    </>
  );
}
