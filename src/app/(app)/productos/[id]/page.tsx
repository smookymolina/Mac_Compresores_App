import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { uuid } from "@/lib/validation";
import { Card, CardHeader, DataTable, EmptyState, PageHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/utils";
import { LINE_LABEL } from "@/modules/products/lines";
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

  return (
    <>
      <PageHeader title={product.sku} subtitle={product.description} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          {editable ? (
            <ProductForm product={product} />
          ) : (
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-soft">Línea</dt><dd>{LINE_LABEL[product.line]}</dd>
              <dt className="text-ink-soft">Unidad</dt><dd>{product.unit}</dd>
              <dt className="text-ink-soft">Precio</dt><dd>{fmtMoney(product.price)}</dd>
            </dl>
          )}
        </Card>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Existencias" />
            <ul className="divide-y divide-line text-sm">
              {product.balances.length === 0 && <li className="px-4 py-3 text-ink-soft">Sin existencias registradas.</li>}
              {product.balances.map((b) => (
                <li key={b.warehouseId} className="flex justify-between px-4 py-2">
                  <span>{b.warehouse.name}</span>
                  <span className="tabular-nums">{b.quantity.toString()} {product.unit}</span>
                </li>
              ))}
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
    </>
  );
}
