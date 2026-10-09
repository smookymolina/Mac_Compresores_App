import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getSale } from "@/modules/sales/service";
import { cancelSaleAction } from "@/modules/sales/actions";
import { LINE_LABEL } from "@/modules/products/lines";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, DataTable, Field, PageHeader, SelectField } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { METHOD_LABEL, dueDate, listPayments, paidOf } from "@/modules/payments/service";
import { registerPaymentAction, voidPaymentAction } from "@/modules/payments/actions";

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("sales.read_all", "sales.read_own");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const s = await getSale(user, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const payments = await listPayments(s.id);
  const paid = paidOf(payments);
  const balance = s.total.sub(paid);
  const due = dueDate(s.confirmedAt, s.customer.paymentTermsDays);
  const overdue = s.status === "CONFIRMED" && balance.gt(0) && due < new Date();
  const canPay = can(user, "payments.write");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <PageHeader
        title={`Venta V-${s.folio}`}
        meta={[
          { label: "Estado", value: s.status === "CONFIRMED" ? <Badge tone="green">Confirmada</Badge> : <Badge tone="red">Cancelada</Badge> },
          { label: "Cotización", value: <Link className="text-accent-fg hover:underline" href={`/cotizaciones/${s.quote.id}`}>Cotización C-{s.quote.folio}</Link> },
          { label: "Cliente", value: s.customer.legalName },
          { label: "Vendedor", value: s.seller.name },
          { label: "Fecha", value: fmtDateTime(s.confirmedAt) },
          { label: "Almacén", value: s.warehouse.name },
          ...(s.status === "CONFIRMED" ? [{
            label: "Cobranza",
            value: balance.lte(0) ? <Badge tone="green">Pagada</Badge> : overdue ? <Badge tone="red">Vencida</Badge> : <Badge tone="amber">Por cobrar</Badge>,
          }] : []),
        ]}
      />
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
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Cobranza" description={`Vence el ${fmtDate(due)} (${s.customer.paymentTermsDays} días de crédito)`} />
          <dl className="grid grid-cols-3 gap-px bg-line text-sm">
            <div className="bg-panel p-4"><dt className="text-ink-soft">Total</dt><dd className="num kpi-value mt-1 text-left text-lg">{fmtMoney(s.total)}</dd></div>
            <div className="bg-panel p-4"><dt className="text-ink-soft">Pagado</dt><dd className="num kpi-value mt-1 text-left text-lg">{fmtMoney(paid)}</dd></div>
            <div className="bg-panel p-4"><dt className="text-ink-soft">Saldo</dt><dd className={`num kpi-value mt-1 text-left text-lg ${overdue ? "text-danger" : ""}`}>{fmtMoney(balance)}</dd></div>
          </dl>
          {payments.length > 0 && (
            <DataTable
              caption="Pagos de la venta"
              columns={[
                { id: "fecha", header: "Fecha", cellClass: "whitespace-nowrap" },
                { id: "forma", header: "Forma" },
                { id: "ref", header: "Referencia" },
                { id: "reg", header: "Registró" },
                { id: "imp", header: "Importe", align: "right" },
                ...(canPay ? [{ id: "acc", header: "" }] : []),
              ]}
              rows={payments.map((p) => ({
                id: p.id,
                cells: [
                  fmtDate(p.paidAt),
                  METHOD_LABEL[p.method],
                  p.voidedAt ? <span key="r" className="text-ink-soft">Anulado: {p.voidReason}</span> : (p.reference ?? "—"),
                  p.createdBy.name,
                  p.voidedAt ? <s key="i" className="text-muted">{fmtMoney(p.amount)}</s> : fmtMoney(p.amount),
                  ...(canPay ? [p.voidedAt ? "" : (
                    <details key="a" className="text-xs">
                      <summary className="cursor-pointer text-danger">Anular</summary>
                      <ActionForm action={voidPaymentAction.bind(null, p.id)} submitLabel="Anular pago" variant="danger" className="mt-2 min-w-56">
                        <Field label="Motivo" name="reason" required minLength={5} />
                      </ActionForm>
                    </details>
                  )] : []),
                ],
              }))}
            />
          )}
          {canPay && s.status === "CONFIRMED" && balance.gt(0) && (
            <div className="border-t border-line p-4">
              <h3 className="mb-3 text-sm font-semibold">Registrar pago</h3>
              <ActionForm action={registerPaymentAction.bind(null, s.id)} submitLabel="Registrar pago" resetOnSuccess className="grid gap-3 sm:grid-cols-2">
                <Field label="Importe" name="amount" inputMode="decimal" defaultValue={balance.toFixed(2)} required />
                <Field label="Fecha de pago" name="paidAt" type="date" defaultValue={today} max={today} required />
                <SelectField label="Forma de pago" name="method" options={Object.entries(METHOD_LABEL).map(([value, label]) => ({ value, label }))} />
                <Field label="Referencia (opcional)" name="reference" maxLength={300} />
              </ActionForm>
            </div>
          )}
        </Card>
        {s.status === "CONFIRMED" && can(user, "commissions.approve") && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Cancelar venta</h3>
            <p className="mb-3 text-xs text-ink-soft">Repone inventario con movimientos compensatorios. No disponible si el periodo de comisiones ya fue aprobado ni si hay pagos vigentes.</p>
            <ActionForm action={cancelSaleAction.bind(null, s.id)} submitLabel="Cancelar venta" variant="danger" confirmText="Confirmo la cancelación.">
              <Field label="Motivo" name="reason" required minLength={5} />
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
