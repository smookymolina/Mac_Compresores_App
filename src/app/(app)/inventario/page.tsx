import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { listBalances, listMovements } from "@/modules/inventory/service";
import { createWarehouseAction, movementAction, reverseMovementAction } from "@/modules/inventory/actions";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, PageHeader, SelectField, TableWrap } from "@/components/ui";
import { fmtDateTime, sp } from "@/lib/utils";

export const metadata = { title: "Inventario" };

const TYPE_LABEL = { IN: "Entrada", OUT: "Salida", ADJUST: "Ajuste", SALE_OUT: "Salida por venta", REVERSAL: "Reversa" } as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ q?: string; wh?: string; low?: string }> }) {
  const user = await requirePagePermission("inventory.read");
  const p = await searchParams;
  const [warehouses, balances, movements] = await Promise.all([
    db.warehouse.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
    listBalances({ warehouseId: sp(p.wh), search: sp(p.q), lowOnly: p.low === "1" }),
    listMovements({ take: 50 }),
  ]);
  const writable = can(user, "inventory.write");
  const reversed = new Set(movements.map((m) => m.reversesId).filter(Boolean));

  return (
    <>
      <PageHeader title="Inventario" subtitle="Movimientos inmutables; las correcciones se registran como reversas auditadas." />
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Existencias" />
          <form className="flex flex-wrap gap-2 border-b border-line p-3">
            <input name="q" defaultValue={p.q} placeholder="SKU o descripción" className="input max-w-xs" />
            <select name="wh" defaultValue={p.wh ?? ""} className="input max-w-48">
              <option value="">Todos los almacenes</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
            <label className="flex items-center gap-1 text-sm"><input type="checkbox" name="low" value="1" defaultChecked={p.low === "1"} /> Solo bajo mínimo</label>
            <button className="rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50">Filtrar</button>
          </form>
          {balances.length === 0 ? (
            <EmptyState title="Sin existencias registradas" />
          ) : (
            <TableWrap>
              <table className="table">
                <thead><tr><th>SKU</th><th>Descripción</th><th>Almacén</th><th className="num">Existencia</th><th className="num">Mínimo</th><th /></tr></thead>
                <tbody>
                  {balances.map((b) => {
                    const low = b.minStock.gt(0) && b.quantity.lte(b.minStock);
                    return (
                      <tr key={`${b.productId}-${b.warehouseId}`}>
                        <td>{b.product.sku}</td>
                        <td>{b.product.description}</td>
                        <td>{b.warehouse.code}</td>
                        <td className="num">{b.quantity.toString()} {b.product.unit}</td>
                        <td className="num">{b.minStock.toString()}</td>
                        <td>{low && <Badge tone="red">Bajo mínimo</Badge>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        {writable && (
          <div className="space-y-4">
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Registrar movimiento</h2>
              <ActionForm action={movementAction} resetOnSuccess submitLabel="Registrar">
                {(e) => (
                  <>
                    <Field label="SKU" name="sku" required error={e?.sku} />
                    <SelectField label="Almacén" name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
                    <SelectField label="Tipo" name="type" options={[
                      { value: "IN", label: "Entrada" }, { value: "OUT", label: "Salida" }, { value: "ADJUST", label: "Ajuste (+/-)" },
                    ]} />
                    <Field label="Cantidad" name="quantity" inputMode="decimal" required error={e?.quantity} />
                    <Field label="Motivo / referencia" name="reason" required error={e?.reason} />
                    <Field label="Stock mínimo (opcional)" name="minStock" inputMode="decimal" error={e?.minStock} />
                  </>
                )}
              </ActionForm>
            </Card>
            <Card className="p-4">
              <h2 className="mb-3 text-sm font-semibold">Nuevo almacén</h2>
              <ActionForm action={createWarehouseAction} resetOnSuccess submitLabel="Crear" variant="secondary">
                <Field label="Código" name="code" required />
                <Field label="Nombre" name="name" required />
              </ActionForm>
            </Card>
          </div>
        )}
      </div>

      <Card className="mt-4">
        <CardHeader title="Últimos movimientos (trazabilidad)" />
        <TableWrap>
          <table className="table">
            <thead><tr><th>Fecha</th><th>SKU</th><th>Almacén</th><th>Tipo</th><th className="num">Cantidad</th><th>Motivo</th><th>Usuario</th>{writable && <th />}</tr></thead>
            <tbody>
              {movements.map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap">{fmtDateTime(m.createdAt)}</td>
                  <td>{m.product.sku}</td>
                  <td>{m.warehouse.code}</td>
                  <td>{TYPE_LABEL[m.type]}</td>
                  <td className="num">{m.quantity.toString()}</td>
                  <td>{m.reason}</td>
                  <td>{m.user.name}</td>
                  {writable && (
                    <td>
                      {["IN", "OUT", "ADJUST"].includes(m.type) && !reversed.has(m.id) && (
                        <ActionForm action={reverseMovementAction.bind(null, m.id)} submitLabel="Revertir" variant="secondary" className="space-y-0">
                          <input type="hidden" name="reason" value="Corrección de captura" />
                        </ActionForm>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
