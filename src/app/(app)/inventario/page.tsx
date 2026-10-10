import Link from "next/link";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listBalances, listMovements, listWarehouses } from "@/modules/inventory/service";
import {
  createWarehouseAction, minStockAction, movementAction, reverseMovementAction, setWarehouseActiveAction,
} from "@/modules/inventory/actions";
import { ActionForm } from "@/components/action-form";
import { Boxes } from "lucide-react";
import { Badge, Card, CardHeader, DataTable, EmptyState, Field, PageHeader, SelectField, type DataColumn, FilteredEmpty, SearchInput } from "@/components/ui";
import { fmtDateTime, sp } from "@/lib/utils";

export const metadata = { title: "Inventario" };

const BALANCE_COLUMNS: DataColumn[] = [
  { id: "sku", header: "SKU", sortable: true, cellClass: "mono whitespace-nowrap" },
  { id: "description", header: "Descripción", sortable: true },
  { id: "warehouse", header: "Almacén", sortable: true },
  { id: "qty", header: "Existencia", align: "right", sortable: true },
  { id: "min", header: "Mínimo", align: "right", sortable: true },
  { id: "low", header: "Estado", sortable: true },
];

const TYPE_LABEL = { IN: "Entrada", OUT: "Salida", ADJUST: "Ajuste", SALE_OUT: "Salida por venta", REVERSAL: "Reversa" } as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; wh?: string; low?: string }> }) {
  const user = await requirePagePermission("inventory.read");
  const p = await searchParams;
  const [allWarehouses, balances, movements] = await Promise.all([
    listWarehouses(),
    listBalances({ warehouseId: sp(p.wh), search: sp(p.q), lowOnly: p.low === "1" }),
    listMovements({ take: 50 }),
  ]);
  const warehouses = allWarehouses.filter((w) => w.active);
  const writable = can(user, "inventory.write");
  const canProducts = can(user, "products.read");
  const reversed = new Set(movements.map((m) => m.reversesId).filter(Boolean));

  return (
    <>
      <PageHeader title="Inventario" subtitle="Movimientos inmutables; las correcciones se registran como reversas auditadas." />
      <div className={writable ? "grid gap-4 xl:grid-cols-3" : undefined}>
        <Card className={writable ? "overflow-hidden xl:col-span-2" : "overflow-hidden"}>
          <CardHeader title="Existencias" />
          <form className="toolbar">
            <SearchInput name="q" defaultValue={p.q} placeholder="SKU o descripción" aria-label="Buscar por SKU o descripción" />
            <select name="wh" aria-label="Almacén" defaultValue={p.wh ?? ""} className="input">
              <option value="">Todos los almacenes</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <label className="flex items-center gap-2 text-sm text-ink-soft"><input type="checkbox" name="low" value="1" defaultChecked={p.low === "1"} /> Solo bajo mínimo</label>
            <button className="btn btn-secondary">Filtrar</button>
          </form>
          <DataTable
            caption="Existencias"
            columns={BALANCE_COLUMNS}
            empty={p.q || p.wh || p.low ? <FilteredEmpty clearHref="/inventario" /> : <EmptyState icon={Boxes} title="Sin existencias registradas">Registra una entrada para empezar a llevar existencias.</EmptyState>}
            rows={balances.map((b) => {
              const low = b.minStock.gt(0) && b.quantity.lte(b.minStock);
              return {
                id: `${b.productId}-${b.warehouseId}`,
                cells: [
                  canProducts
                    ? <Link key="s" className="font-medium text-accent-fg hover:underline" href={`/productos/${b.productId}`}>{b.product.sku}</Link>
                    : b.product.sku,
                  b.product.description, b.warehouse.code,
                  `${b.quantity.toString()} ${b.product.unit}`, b.minStock.toString(),
                  low ? <Badge key="l" tone="red">Bajo mínimo</Badge> : <Badge key="l" tone="green">En stock</Badge>,
                ],
                sort: [b.product.sku, b.product.description, b.warehouse.code, b.quantity.toNumber(), b.minStock.toNumber(), low ? 1 : 0],
              };
            })}
          />
        </Card>

        {writable && (
          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Registrar movimiento</h2>
              <ActionForm action={movementAction} resetOnSuccess submitLabel="Registrar">
                  <>
                    <Field label="SKU" name="sku" required />
                    <SelectField label="Almacén" name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                    <SelectField label="Tipo" name="type" options={[
                      { value: "IN", label: "Entrada" }, { value: "OUT", label: "Salida" }, { value: "ADJUST", label: "Ajuste (+/-)" },
                    ]} />
                    <Field label="Cantidad" name="quantity" inputMode="decimal" required />
                    <Field label="Motivo / referencia" name="reason" required />
                    <Field label="Stock mínimo (opcional)" name="minStock" inputMode="decimal" />
                  </>
              </ActionForm>
            </Card>
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold">Stock mínimo</h2>
              <p className="mb-3 text-xs text-ink-soft">Define el mínimo sin registrar un movimiento. Con 0 se deja de vigilar.</p>
              <ActionForm action={minStockAction} resetOnSuccess submitLabel="Guardar mínimo" variant="secondary">
                <Field label="Producto (SKU)" name="minSku" required />
                <SelectField label="Almacén" name="minWarehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                <Field label="Stock mínimo" name="minQty" inputMode="decimal" required />
              </ActionForm>
            </Card>
            <Card className="overflow-hidden">
              <CardHeader title="Almacenes" />
              <ul className="divide-y divide-line text-sm">
                {allWarehouses.length === 0 && <li className="px-4 py-3 text-ink-soft">Sin almacenes. Crea el primero abajo.</li>}
                {allWarehouses.map((w) => (
                  <li key={w.id} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span className="break-words">{w.name}</span>
                        {!w.active && <Badge>Inactivo</Badge>}
                      </p>
                      <p className="text-xs text-ink-soft"><span className="mono">{w.code}</span> · {w.productsInStock} productos con existencia</p>
                    </div>
                    {w.active ? (
                      <ActionForm action={setWarehouseActiveAction.bind(null, w.id, false)} submitLabel="Desactivar" variant="secondary" size="sm" className="section-row-action" />
                    ) : (
                      <ActionForm action={setWarehouseActiveAction.bind(null, w.id, true)} submitLabel="Reactivar" variant="secondary" size="sm" className="section-row-action" />
                    )}
                  </li>
                ))}
              </ul>
              <div className="border-t border-line p-4">
                <h3 className="mb-3 text-sm font-semibold">Nuevo almacén</h3>
                <ActionForm action={createWarehouseAction} resetOnSuccess submitLabel="Crear" variant="secondary">
                  <Field label="Código" name="code" required />
                  <Field label="Nombre" name="name" required />
                </ActionForm>
              </div>
            </Card>
          </div>
        )}
      </div>

      <Card className="mt-4 overflow-hidden">
        <CardHeader title="Últimos movimientos (trazabilidad)" />
        <DataTable
          caption="Últimos movimientos de inventario"
          columns={[
            { id: "fecha", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
            { id: "sku", header: "SKU", sortable: true, cellClass: "mono" },
            { id: "alm", header: "Almacén", sortable: true },
            { id: "tipo", header: "Tipo", sortable: true },
            { id: "cant", header: "Cantidad", align: "right", sortable: true },
            { id: "motivo", header: "Motivo" },
            { id: "usuario", header: "Usuario", sortable: true },
            ...(writable ? [{ id: "acc", header: "Acción" }] : []),
          ]}
          rows={movements.map((m) => ({
            id: m.id,
            cells: [
              fmtDateTime(m.createdAt),
              m.product.sku,
              m.warehouse.code,
              TYPE_LABEL[m.type],
              m.quantity.toString(),
              m.reason,
              m.user.name,
              ...(writable
                ? [["IN", "OUT", "ADJUST"].includes(m.type) && !reversed.has(m.id) ? (
                    <ActionForm key="rev" action={reverseMovementAction.bind(null, m.id)} submitLabel="Revertir" variant="secondary" className="space-y-0">
                      <input type="hidden" name="reason" value="Corrección de captura" />
                    </ActionForm>
                  ) : null]
                : []),
            ],
            sort: [m.createdAt.getTime(), m.product.sku, m.warehouse.code, TYPE_LABEL[m.type], m.quantity.toNumber(), m.reason, m.user.name],
          }))}
          empty={<EmptyState title="Sin movimientos">Las entradas, salidas y ajustes de inventario aparecerán aquí.</EmptyState>}
        />
      </Card>
    </>
  );
}
