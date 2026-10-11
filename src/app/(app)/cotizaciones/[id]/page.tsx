import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getQuote } from "@/modules/quotes/service";
import { QUOTE_STATUS_LABEL, QUOTE_TRANSITIONS } from "@/modules/quotes/status";
import { changeQuoteStatusAction, convertToSaleAction, deleteQuoteAction, emailQuoteAction, logQuoteWhatsAppAction, shareQuoteLinkAction } from "@/modules/quotes/actions";
import { SENDABLE, suggestedPhone, suggestedRecipient } from "@/modules/quotes/email";
import { isMailConfigured } from "@/lib/mail";
import { shareUnavailableReason } from "@/lib/share";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, LinkButton, DataTable, PageHeader, SelectField, btnClass } from "@/components/ui";
import { SendDialog, type SendSuggestion } from "@/components/ui/send-dialog";
import { Download } from "lucide-react";
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

  const canSend = writable && SENDABLE.has(q.status);
  const aside = (writable && transitions.length > 0) || warehouses.length > 0;
  const total = `${fmtMoney(q.total)} ${q.currency}`;
  const suggestions: SendSuggestion[] = [
    { label: "Cliente", email: q.customer.email, phone: q.customer.phone },
    ...q.customer.contacts.map((c) => ({ label: c.name, email: c.email, phone: c.phone })),
  ].filter((s) => s.email || s.phone);
  const draftNote = q.status === "DRAFT" ? " La cotización pasará a «Enviada»." : "";

  return (
    <>
      <PageHeader
        title={`Cotización C-${q.folio}`}
        meta={[
          { label: "Estado", value: <QuoteStatusBadge status={q.status} /> },
          ...(q.sale ? [{ label: "Venta", value: <Link className="text-accent-fg hover:underline" href={`/ventas/${q.sale.id}`}>Venta V-{q.sale.folio}</Link> }] : []),
          { label: "Cliente", value: q.customer.legalName },
          { label: "Vendedor", value: q.seller.name },
          { label: "Vigente hasta", value: fmtDate(q.validUntil) },
        ]}
        actions={
          <>
            <a className={btnClass("secondary")} href={`/api/cotizaciones/${q.id}/pdf`} target="_blank" rel="noopener" aria-label="Descargar PDF">
              <Download size={16} strokeWidth={1.75} aria-hidden /> PDF
            </a>
            {writable && q.status === "DRAFT" && <LinkButton variant="secondary" href={`/cotizaciones/${q.id}/editar`}>Editar</LinkButton>}
            {canSend && (
              <SendDialog
                triggerLabel="Enviar cotización"
                triggerShortLabel="Enviar"
                triggerVariant="primary"
                title={`Enviar cotización C-${q.folio}`}
                docName={`Cotización C-${q.folio}`}
                file={{ url: `/api/cotizaciones/${q.id}/pdf`, filename: `cotizacion-C${q.folio}.pdf`, type: "application/pdf" }}
                suggestions={suggestions}
                email={{
                  action: emailQuoteAction.bind(null, q.id),
                  unavailable: isMailConfigured() ? null : "El envío de correos no está configurado. Contacta al administrador.",
                  defaultTo: suggestedRecipient(q),
                  defaultMessage: `Estimado cliente:\n\nAdjuntamos la cotización C-${q.folio} solicitada. Quedamos atentos a cualquier duda.\n\nSaludos cordiales.`,
                  note: `Se adjunta el PDF; las respuestas llegan a ${q.seller.email}.${draftNote}`,
                }}
                whatsapp={{
                  linkAction: shareQuoteLinkAction.bind(null, q.id),
                  logAction: logQuoteWhatsAppAction.bind(null, q.id),
                  unavailable: shareUnavailableReason(),
                  defaultPhone: suggestedPhone(q),
                  defaultMessage: `Hola, te comparto la cotización C-${q.folio} de MAC Compresores por ${total}, vigente hasta el ${fmtDate(q.validUntil)}. Puedes descargar el PDF aquí:`,
                  note: `Cualquiera con el enlace puede ver el PDF.${draftNote}`,
                }}
              />
            )}
          </>
        }
      />

      <div className={aside ? "grid grid-cols-1 gap-4 lg:grid-cols-3" : undefined}>
        <Card className={aside ? "overflow-hidden lg:col-span-2" : "overflow-hidden"}>
          <CardHeader title="Partidas (precios congelados)" />
          {/* Móvil: partidas como tarjetas; la tabla queda para md+ */}
          <ul className="divide-y divide-line md:hidden" aria-label="Partidas de la cotización">
            {q.items.map((i) => (
              <li key={i.id} className="space-y-1 px-4 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <b className="break-words">{i.position}. {i.sku}</b>
                    <div className="break-words text-xs text-ink-soft">{i.description}</div>
                    {i.origCurrency === "USD" && i.origUnitPrice && <div className="text-xs text-ink-soft">USD {i.origUnitPrice.toFixed(2)} × TC {i.fxRate.toFixed(4)}</div>}
                    {i.details && <div className="mt-1 whitespace-pre-line break-words text-xs">{i.details}</div>}
                  </div>
                  <span className="num shrink-0 font-medium">{fmtMoney(i.subtotal.sub(i.discount))}</span>
                </div>
                <div className="flex flex-wrap gap-x-3 text-xs tabular-nums text-ink-soft">
                  <span>{i.quantity.toString()} {i.unit} × {fmtMoney(i.unitPrice)}</span>
                  {!i.discountPct.isZero() && <span>Desc. {fmtPct(i.discountPct)}</span>}
                  <span>IVA {fmtPct(i.taxRate)}</span>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
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
                <div key="c"><b>{i.sku}</b><div className="text-xs text-ink-soft">{i.description}</div>
                  {i.origCurrency === "USD" && i.origUnitPrice && <div className="text-xs text-ink-soft">USD {i.origUnitPrice.toFixed(2)} × TC {i.fxRate.toFixed(4)}</div>}
                  {i.details && <div className="mt-1 whitespace-pre-line text-xs">{i.details}</div>}</div>,
                `${i.quantity.toString()} ${i.unit}`,
                fmtMoney(i.unitPrice),
                i.discountPct.isZero() ? "—" : fmtPct(i.discountPct),
                fmtPct(i.taxRate),
                fmtMoney(i.subtotal.sub(i.discount)),
              ],
            }))}
          />
          </div>
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 border-t border-line p-4 text-sm md:ml-auto md:w-72 md:border-t-0">
            <dt className="text-ink-soft">Subtotal</dt><dd className="num">{fmtMoney(q.subtotal)}</dd>
            <dt className="text-ink-soft">Descuento</dt><dd className="num">-{fmtMoney(q.discountTotal)}</dd>
            <dt className="text-ink-soft">IVA</dt><dd className="num">{fmtMoney(q.taxTotal)}</dd>
            <dt className="font-semibold">Total</dt><dd className="num font-semibold">{fmtMoney(q.total)}</dd>
          </dl>
          {q.notes && <p className="border-t border-line p-4 text-sm break-words whitespace-pre-line">{q.notes}</p>}
        </Card>

        <div className="space-y-4">
          {writable && transitions.length > 0 && (
            <Card className="p-4">
              <ActionForm action={changeQuoteStatusAction.bind(null, q.id)} submitLabel="Cambiar estado" variant="secondary">
                <SelectField label="Nuevo estado" name="to" options={transitions.map((t) => ({ value: t, label: QUOTE_STATUS_LABEL[t] }))} />
              </ActionForm>
            </Card>
          )}
          {can(user, "quotes.delete") && !q.sale && q.status !== "CONVERTED" && (
            <Card className="p-4">
              <p className="mb-2 text-sm text-ink-soft">Eliminar borra la cotización y sus partidas de forma permanente.</p>
              <ActionForm action={deleteQuoteAction.bind(null, q.id)} submitLabel="Eliminar cotización" variant="danger"
                confirmText={`Confirmo que quiero eliminar la cotización C-${q.folio}`} />
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
