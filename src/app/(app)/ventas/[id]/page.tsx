import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getSale } from "@/modules/sales/service";
import { cancelSaleAction } from "@/modules/sales/actions";
import { LINE_LABEL } from "@/modules/products/lines";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, DataTable, Field, PageHeader } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/utils";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const s = await getSale(user, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });

  return (
    <>
      <PageHeader
        title={`Venta V-${s.folio}`}
        subtitle={`${s.customer.legalName} · ${s.seller.name} · ${fmtDateTime(s.confirmedAt)} · ${s.warehouse.name}`}
      />
      <div className="mb-4 flex items-center gap-3 text-sm">
        {s.status === "CONFIRMED" ? <Badge tone="green">Confirmada</Badge> : <Badge tone="red">Cancelada</Badge>}
        <Link className="font-medium text-accent-fg hover:underline" href={`/cotizaciones/${s.quote.id}`}>Cotización C-{s.quote.folio}</Link>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Partidas" />
          <DataTable
            caption="Partidas de la venta"
            columns={[
              { id: "concepto", header: "Concepto" },
              { id: "linea", header: "Línea" },
              { id: "cant", header: "Cant.", align: "right", cellClass: "whitespace-nowrap" },
              { id: "pu", header: "P. unit.", align: "right" },
              { id: "imp", header: "Importe neto", align: "right" },
            ]}
            rows={s.items.map((i) => ({
              id: i.id,
              cells: [
                <div key="c"><b>{i.sku}</b><div className="text-xs text-ink-soft">{i.description}</div></div>,
                <span key="l" className="text-ink-soft">{LINE_LABEL[i.line].split(" (")[0]}</span>,
                `${i.quantity.toString()} ${i.unit}`,
                fmtMoney(i.unitPrice),
                fmtMoney(i.subtotal.sub(i.discount)),
              ],
            }))}
          />
          <dl className="ml-auto grid w-64 grid-cols-2 gap-1 p-4 text-sm">
            <dt className="text-ink-soft">Subtotal</dt><dd className="num">{fmtMoney(s.subtotal)}</dd>
            <dt className="text-ink-soft">Descuento</dt><dd className="num">-{fmtMoney(s.discountTotal)}</dd>
            <dt className="text-ink-soft">IVA</dt><dd className="num">{fmtMoney(s.taxTotal)}</dd>
            <dt className="font-semibold">Total</dt><dd className="num font-semibold">{fmtMoney(s.total)}</dd>
          </dl>
        </Card>
        {s.status === "CONFIRMED" && can(user, "commissions.approve") && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Cancelar venta</h3>
            <p className="mb-3 text-xs text-ink-soft">Repone inventario con movimientos compensatorios. No disponible si el periodo de comisiones ya fue aprobado.</p>
            <ActionForm action={cancelSaleAction.bind(null, s.id)} submitLabel="Cancelar venta" variant="danger" confirmText="Confirmo la cancelación.">
              <Field label="Motivo" name="reason" required minLength={5} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
