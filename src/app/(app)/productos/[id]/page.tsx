import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { uuid } from "@/lib/validation";
import { Badge, Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { fmtMoney, fmtPct } from "@/lib/money";
import { fmtDateTime } from "@/lib/utils";
import { LINE_LABEL } from "@/modules/products/lines";
import { listMovements } from "@/modules/inventory/service";

const MOVE_LABEL = { IN: "Entrada", OUT: "Salida", ADJUST: "Ajuste", SALE_OUT: "Salida por venta", REVERSAL: "Reversa" } as const;
import { ProductForm } from "../product-form";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("products.read");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const product = await db.product.findUnique({
    where: { id },
    include: {
      category: true,
      priceHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      balances: { include: { warehouse: true } },
    },
  });
  if (!product) notFound();
  const editable = can(user, "products.write");
  const canInventory = can(user, "inventory.read") && product.kind === "PRODUCT";
  const movements = canInventory ? await listMovements({ productId: product.id, take: 20 }) : [];

  return (
    <>
      <PageHeader
        title={product.sku}
        subtitle={product.description}
        meta={[
          { label: "Estado", value: product.status === "ACTIVE" ? "Activo" : "Inactivo" },
          { label: "Tipo", value: product.kind === "SERVICE" ? "Servicio" : "Producto" },
        ]}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          {editable ? (
            <ProductForm product={product} />
          ) : (
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-ink-soft">Línea</dt><dd>{LINE_LABEL[product.line]}</dd>
              <dt className="text-ink-soft">Categoría</dt><dd>{product.category?.name ?? "—"}</dd>
              <dt className="text-ink-soft">Unidad</dt><dd>{product.unit}</dd>
              <dt className="text-ink-soft">Marca OEM</dt><dd>{product.oemName ?? "—"}</dd>
              <dt className="text-ink-soft">No. parte OEM</dt><dd className="mono break-all">{product.oemPartNumber ?? "—"}</dd>
              <dt className="text-ink-soft">Item # / proveedor</dt><dd className="mono break-all">{product.supplierCode ?? "—"}</dd>
              <dt className="text-ink-soft">Precio</dt>
              <dd>{product.price.isZero() ? <Badge tone="amber">Sin precio</Badge> : <span className="num">{fmtMoney(product.price)}</span>}</dd>
              <dt className="text-ink-soft">IVA</dt><dd className="num">{fmtPct(product.taxRate)}</dd>
            </dl>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Existencias" />
            <ul className="divide-y divide-line text-sm">
              {product.kind === "SERVICE" && <li className="px-4 py-3 text-ink-soft">Servicio: no maneja inventario.</li>}
              {product.kind === "PRODUCT" && product.balances.length === 0 && <li className="px-4 py-3 text-ink-soft">Sin existencias registradas.</li>}
              {product.balances.map((b) => {
                const low = b.minStock.gt(0) && b.quantity.lte(b.minStock);
                return (
                  <li key={b.warehouseId} className="flex items-center justify-between gap-3 px-4 py-2">
                    <span className="min-w-0">
                      {b.warehouse.name}
                      {b.minStock.gt(0) && <span className="block text-xs text-muted">Mínimo {b.minStock.toString()}</span>}
                    </span>
                    <span className="flex items-center gap-2">
                      {low && <Badge tone="red">Bajo mínimo</Badge>}
                      <span className="tabular-nums">{b.quantity.toString()} {product.unit}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Card>
          {editable && (
            <Card className="overflow-hidden">
              <CardHeader title="Historial de precios" />
              <DataTable
                caption="Historial de precios"
                columns={[
                  { id: "fecha", header: "Fecha", cellClass: "whitespace-nowrap" },
                  { id: "costo", header: "Costo", align: "right" },
                  { id: "precio", header: "Precio", align: "right" },
                ]}
                rows={product.priceHistory.map((h) => ({ id: h.id, cells: [fmtDateTime(h.createdAt), fmtMoney(h.cost), fmtMoney(h.price)] }))}
                empty={<EmptyState title="Sin cambios de precio">Cada cambio de costo o precio queda registrado aquí.</EmptyState>}
              />
            </Card>
          )}
        </div>
      </div>
      {canInventory && (
        <Card className="mt-4 overflow-hidden">
          <CardHeader title="Últimos movimientos" />
          <DataTable
            caption={`Últimos movimientos de ${product.sku}`}
            columns={[
              { id: "fecha", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
              { id: "alm", header: "Almacén", sortable: true },
              { id: "tipo", header: "Tipo", sortable: true },
              { id: "cant", header: "Cantidad", align: "right", sortable: true },
              { id: "motivo", header: "Motivo" },
              { id: "usuario", header: "Usuario", sortable: true },
            ]}
            rows={movements.map((m) => ({
              id: m.id,
              cells: [fmtDateTime(m.createdAt), m.warehouse.code, MOVE_LABEL[m.type], m.quantity.toString(), m.reason, m.user.name],
              sort: [m.createdAt.getTime(), m.warehouse.code, MOVE_LABEL[m.type], m.quantity.toNumber(), null, m.user.name],
            }))}
            empty={<EmptyState title="Sin movimientos">Las entradas, salidas y ajustes de este producto aparecerán aquí.</EmptyState>}
          />
        </Card>
      )}
    </>
  );
}
