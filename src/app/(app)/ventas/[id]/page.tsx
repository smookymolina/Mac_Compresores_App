import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getSale } from "@/modules/sales/service";
import { cancelSaleAction, setSaleExpensesAction } from "@/modules/sales/actions";
import { LINE_LABEL } from "@/modules/products/lines";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, DataTable, Field, PageHeader, SelectField } from "@/components/ui";
import { fmtMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/utils";
import { METHOD_LABEL, dueDate, listPayments, paidOf } from "@/modules/payments/service";
import { registerPaymentAction, voidPaymentAction } from "@/modules/payments/actions";
import { reminderDraftsFor } from "@/modules/payments/reminder";
import { isMailConfigured } from "@/lib/mail";
import { ReminderButton } from "@/components/payments/reminder-dialog";

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
  // Recordatorio de pago por correo (manual): mismo permiso que registrar pagos.
  const reminder = canPay && s.status === "CONFIRMED" && balance.gt(0)
    ? (await reminderDraftsFor([{ id: s.id, folio: s.folio, customer: s.customer.legalName, total: s.total, paid, balance, due }])).get(s.id)
    : undefined;

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader title="Partidas" />
          {/* Móvil: partidas como tarjetas; la tabla queda para md+ */}
          <ul className="divide-y divide-line md:hidden" aria-label="Partidas de la venta">
            {s.items.map((i) => (
              <li key={i.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <b className="break-words">{i.sku}</b>
                    <div className="break-words text-xs text-ink-soft">{i.description}</div>
                    {i.origCurrency === "USD" && i.origUnitPrice && <div className="text-xs text-ink-soft">USD {i.origUnitPrice.toFixed(2)} × TC {i.fxRate.toFixed(4)}</div>}
                    {i.details && <div className="mt-1 whitespace-pre-line break-words text-xs">{i.details}</div>}
                  </div>
                  <span className="num shrink-0 font-medium">{fmtMoney(i.subtotal.sub(i.discount))}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs tabular-nums text-ink-soft">
                  <span>{i.quantity.toString()} {i.unit} × {fmtMoney(i.unitPrice)}</span>
                  <span>{LINE_LABEL[i.line].split(" (")[0]}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
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
                <div key="c"><b>{i.sku}</b><div className="text-xs text-ink-soft">{i.description}</div>
                  {i.origCurrency === "USD" && i.origUnitPrice && <div className="text-xs text-ink-soft">USD {i.origUnitPrice.toFixed(2)} × TC {i.fxRate.toFixed(4)}</div>}
                  {i.details && <div className="mt-1 whitespace-pre-line text-xs">{i.details}</div>}</div>,
                <span key="l" className="text-ink-soft">{LINE_LABEL[i.line].split(" (")[0]}</span>,
                `${i.quantity.toString()} ${i.unit}`,
                fmtMoney(i.unitPrice),
                fmtMoney(i.subtotal.sub(i.discount)),
              ],
            }))}
          />
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-line p-4 text-sm md:ml-auto md:w-72 md:border-t-0">
            <dt className="text-ink-soft">Subtotal</dt><dd className="num">{fmtMoney(s.subtotal)}</dd>
            <dt className="text-ink-soft">Descuento</dt><dd className="num">-{fmtMoney(s.discountTotal)}</dd>
            <dt className="text-ink-soft">IVA</dt><dd className="num">{fmtMoney(s.taxTotal)}</dd>
            <dt className="font-semibold">Total</dt><dd className="num font-semibold">{fmtMoney(s.total)}</dd>
          </dl>
        </Card>
        <Card className="overflow-hidden lg:col-span-2">
          <CardHeader
            title="Cobranza"
            description={`Vence el ${fmtDate(due)} (${s.customer.paymentTermsDays} días de crédito)${reminder?.lastSentAt ? ` · Último recordatorio: ${fmtDateTime(reminder.lastSentAt)}` : ""}`}
            actions={reminder && (
              <ReminderButton
                variant="button" saleId={s.id} folio={s.folio} customer={s.customer.legalName} balance={fmtMoney(balance)}
                due={fmtDate(due)} replyTo={reminder.replyTo} to={reminder.to} message={reminder.message}
                lastSentAt={reminder.lastSentAt} nextAllowedAt={reminder.nextAllowedAt} mailConfigured={isMailConfigured()}
              />
            )}
          />
          <dl className="grid grid-cols-3 gap-px bg-line text-sm">
            <div className="min-w-0 bg-panel p-3 sm:p-4"><dt className="text-xs text-ink-soft sm:text-sm">Total</dt><dd className="num kpi-value mt-1 text-left text-sm [overflow-wrap:anywhere] sm:text-lg">{fmtMoney(s.total)}</dd></div>
            <div className="min-w-0 bg-panel p-3 sm:p-4"><dt className="text-xs text-ink-soft sm:text-sm">Pagado</dt><dd className="num kpi-value mt-1 text-left text-sm [overflow-wrap:anywhere] sm:text-lg">{fmtMoney(paid)}</dd></div>
            <div className="min-w-0 bg-panel p-3 sm:p-4"><dt className="text-xs text-ink-soft sm:text-sm">Saldo</dt><dd className={`num kpi-value mt-1 text-left text-sm [overflow-wrap:anywhere] sm:text-lg ${overdue ? "text-danger" : ""}`}>{fmtMoney(balance)}</dd></div>
          </dl>
          {payments.length > 0 && (
            <ul className="divide-y divide-line border-t border-line md:hidden" aria-label="Pagos de la venta">
              {payments.map((p) => (
                <li key={p.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span>{fmtDate(p.paidAt)} · {METHOD_LABEL[p.method]}</span>
                    {p.voidedAt ? <s className="num shrink-0 text-muted">{fmtMoney(p.amount)}</s> : <span className="num shrink-0 font-medium">{fmtMoney(p.amount)}</span>}
                  </div>
                  <div className="break-words text-xs text-ink-soft">
                    {p.voidedAt ? `Anulado: ${p.voidReason}` : (p.reference ?? "Sin referencia")} · Registró {p.createdBy.name}
                  </div>
                  {canPay && !p.voidedAt && (
                    <details className="pt-1">
                      <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm text-danger">Anular pago</summary>
                      <ActionForm action={voidPaymentAction.bind(null, p.id)} submitLabel="Anular pago" variant="danger" className="mt-2">
                        <Field label="Motivo" name="reason" required minLength={5} />
                      </ActionForm>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {payments.length > 0 && (
            <div className="hidden md:block">
            <DataTable mobileCards
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
            </div>
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
        {s.status === "CONFIRMED" && can(user, "commissions.manage") && (
          <Card className="p-4">
            <h3 className="mb-2 text-sm font-semibold">Gastos de la venta</h3>
            <p className="mb-3 text-xs text-ink-soft">Viáticos, maniobras u otros gastos no incluidos en el costo. Se restan a la utilidad neta sobre la que se calcula la comisión.</p>
            <ActionForm action={setSaleExpensesAction.bind(null, s.id)} submitLabel="Guardar gastos" variant="secondary">
              <Field label="Gastos (MXN, sin IVA)" name="expenses" inputMode="decimal" defaultValue={s.expenses.toString()} required />
            </ActionForm>
          </Card>
        )}
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
