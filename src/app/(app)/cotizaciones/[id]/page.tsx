import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getQuote } from "@/modules/quotes/service";
import { QUOTE_STATUS_LABEL, QUOTE_TRANSITIONS } from "@/modules/quotes/status";
import { changeQuoteStatusAction, convertToSaleAction } from "@/modules/quotes/actions";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, LinkButton, DataTable, PageHeader, SelectField, btnClass } from "@/components/ui";
import { fmtMoney, fmtPct } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { QuoteStatusBadge } from "../status-badge";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("quotes.read_all", "quotes.read_own");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const q = await getQuote(user, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const writable = can(user, "quotes.write");
  const transitions = QUOTE_TRANSITIONS[q.status];
  const warehouses = q.status === "ACCEPTED" && can(user, "sales.create") ? await db.warehouse.findMany({ where: { active: true } }) : [];

  const aside = (writable && transitions.length > 0) || warehouses.length > 0;

  return (
    <>
      <PageHeader
        title={`Cotización C-${q.folio}`}
        subtitle={`${q.customer.legalName} · ${q.seller.name} · vigente hasta ${fmtDate(q.validUntil)}`}
        actions={
          <>
            <a className={btnClass("secondary")} href={`/api/cotizaciones/${q.id}/pdf`} target="_blank" rel="noopener">PDF</a>
            {writable && q.status === "DRAFT" && <LinkButton href={`/cotizaciones/${q.id}/editar`}>Editar</LinkButton>}
          </>
        }
      />
      <div className="mb-4 flex items-center gap-2"><QuoteStatusBadge status={q.status} />
        {q.sale && <Link className="text-sm font-medium text-accent-fg hover:underline" href={`/ventas/${q.sale.id}`}>Venta V-{q.sale.folio}</Link>}
      </div>

      <div className={aside ? "grid gap-4 lg:grid-cols-3" : undefined}>
        <Card className={aside ? "overflow-hidden lg:col-span-2" : "overflow-hidden"}>
          <CardHeader title="Partidas (precios congelados)" />
          <DataTable
            caption="Partidas de la cotización"
            columns={[
              { id: "pos", header: "#", align: "right" },
              { id: "concepto", header: "Concepto" },
              { id: "cant", header: "Cant.", align: "right", cellClass: "whitespace-nowrap" },
              { id: "pu", header: "P. unit.", align: "right" },
              { id: "desc", header: "Desc.", align: "right" },
              { id: "iva", header: "IVA", align: "right" },
              { id: "imp", header: "Importe", align: "right" },
            ]}
            rows={q.items.map((i) => ({
              id: i.id,
              cells: [
                i.position,
                <div key="c"><b>{i.sku}</b><div className="text-xs text-ink-soft">{i.description}</div></div>,
                `${i.quantity.toString()} ${i.unit}`,
                fmtMoney(i.unitPrice),
                i.discountPct.isZero() ? "—" : fmtPct(i.discountPct),
                fmtPct(i.taxRate),
                fmtMoney(i.subtotal.sub(i.discount)),
              ],
            }))}
          />
          <dl className="ml-auto grid w-64 grid-cols-2 gap-1 p-4 text-sm">
            <dt className="text-ink-soft">Subtotal</dt><dd className="num">{fmtMoney(q.subtotal)}</dd>
            <dt className="text-ink-soft">Descuento</dt><dd className="num">-{fmtMoney(q.discountTotal)}</dd>
            <dt className="text-ink-soft">IVA</dt><dd className="num">{fmtMoney(q.taxTotal)}</dd>
            <dt className="font-semibold">Total</dt><dd className="num font-semibold">{fmtMoney(q.total)}</dd>
          </dl>
          {q.notes && <p className="border-t border-line p-4 text-sm whitespace-pre-line">{q.notes}</p>}
        </Card>

        <div className="space-y-4">
          {writable && transitions.length > 0 && (
            <Card className="p-4">
              <ActionForm action={changeQuoteStatusAction.bind(null, q.id)} submitLabel="Cambiar estado" variant="secondary">
                <SelectField label="Nuevo estado" name="to" options={transitions.map((t) => ({ value: t, label: QUOTE_STATUS_LABEL[t] }))} />
              </ActionForm>
            </Card>
          )}
          {warehouses.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-2 text-sm font-semibold">Confirmar venta</h3>
              <p className="mb-3 text-xs text-ink-soft">Crea la venta con los precios de esta cotización y descuenta inventario de los productos.</p>
              <ActionForm action={convertToSaleAction.bind(null, q.id)} submitLabel="Convertir en venta" confirmText="Confirmo que el cliente aceptó esta cotización.">
                <SelectField label="Almacén de salida" name="warehouseId" options={warehouses.map((w) => ({ value: w.id, label: w.name }))} />
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
