import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getCustomer } from "@/modules/customers/service";
import {
  addAddressAction, addContactAction, removeAddressAction, removeContactAction, setCustomerActiveAction,
} from "@/modules/customers/actions";
import { listSellers } from "@/modules/users/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, DataTable, EmptyState, Field, LinkButton, PageHeader, type DataColumn } from "@/components/ui";

const HIST_COLS: DataColumn[] = [
  { id: "folio", header: "Folio", sortable: true },
  { id: "fecha", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "estado", header: "Estado", sortable: true },
  { id: "total", header: "Total", align: "right", sortable: true },
];
import { fmtMoney } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { CustomerForm } from "../customer-form";

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("customers.read");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const c = await getCustomer(user, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const writable = can(user, "customers.write") && (can(user, "quotes.read_all") || !c.ownerId || c.ownerId === user.id);
  const sellers = can(user, "quotes.read_all") ? await listSellers() : undefined;

  return (
    <>
      <PageHeader
        title={c.legalName}
        meta={[
          { label: "RFC", value: c.rfc ?? "Sin RFC" },
          { label: "Vendedor", value: c.owner?.name ?? "Sin asignar" },
          { label: "Estado", value: c.active ? "Activo" : "Inactivo" },
        ]}
        actions={c.active && can(user, "quotes.write") && <LinkButton href={`/cotizaciones/nueva?cliente=${c.id}`}>Nueva cotización</LinkButton>}
      />
      {!c.active && (
        <p role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-sm text-ink-soft">
          <Badge>Inactivo</Badge> Este cliente no se ofrece para nuevas cotizaciones; su historial se conserva.
        </p>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {writable && <Card className="p-4"><CustomerForm customer={c} sellers={sellers} /></Card>}
          <Card className="overflow-hidden">
            <CardHeader title="Historial de cotizaciones" />
            <DataTable
              caption="Historial de cotizaciones"
              columns={HIST_COLS}
              rows={c.quotes.map((q) => ({
                id: q.id,
                cells: [
                  <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/cotizaciones/${q.id}`}>C-{q.folio}</Link>,
                  fmtDate(q.createdAt),
                  QUOTE_STATUS_LABEL[q.status],
                  fmtMoney(q.total),
                ],
                sort: [q.folio, q.createdAt.getTime(), QUOTE_STATUS_LABEL[q.status], q.total.toNumber()],
              }))}
              empty={<EmptyState title="Sin cotizaciones">Las cotizaciones de este cliente aparecerán aquí.</EmptyState>}
            />
          </Card>
          <Card className="overflow-hidden">
            <CardHeader title="Historial de ventas" />
            <DataTable
              caption="Historial de ventas"
              columns={HIST_COLS}
              rows={c.sales.map((s) => ({
                id: s.id,
                cells: [
                  <Link key="f" className="font-medium text-accent-fg hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link>,
                  fmtDate(s.confirmedAt),
                  s.status === "CONFIRMED" ? "Confirmada" : "Cancelada",
                  fmtMoney(s.total),
                ],
                sort: [s.folio, s.confirmedAt.getTime(), s.status, s.total.toNumber()],
              }))}
              empty={<EmptyState title="Sin ventas">Las ventas confirmadas de este cliente aparecerán aquí.</EmptyState>}
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Contactos" />
            <ul className="divide-y divide-line text-sm">
              {c.contacts.length === 0 && <li className="px-4 py-3 text-ink-soft">Sin contactos registrados.</li>}
              {c.contacts.map((ct) => (
                <li key={ct.id} className="flex items-start justify-between gap-3 px-4 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{ct.name}</p>
                    <p className="break-words text-xs text-ink-soft">{[ct.position, ct.email, ct.phone].filter(Boolean).join(" · ")}</p>
                  </div>
                  {writable && (
                    <ActionForm action={removeContactAction.bind(null, c.id, ct.id)} submitLabel="Quitar" variant="secondary" size="sm" className="section-row-action" />
                  )}
                </li>
              ))}
            </ul>
            {writable && (
              <div className="border-t border-line p-4">
                <ActionForm action={addContactAction.bind(null, c.id)} submitLabel="Agregar contacto" resetOnSuccess variant="secondary">
                  <Field label="Nombre" name="name" required />
                  <Field label="Puesto" name="position" />
                  <Field label="Correo" name="email" type="email" />
                  <Field label="Teléfono" name="phone" />
                </ActionForm>
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Direcciones" />
            <ul className="divide-y divide-line text-sm">
              {c.addresses.length === 0 && <li className="px-4 py-3 text-ink-soft">Sin direcciones registradas.</li>}
              {c.addresses.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-2">
                  <span className="min-w-0 break-words">{[a.street, a.city, a.state, a.zip].filter(Boolean).join(", ")}</span>
                  {writable && (
                    <ActionForm action={removeAddressAction.bind(null, c.id, a.id)} submitLabel="Quitar" variant="secondary" size="sm" className="section-row-action" />
                  )}
                </li>
              ))}
            </ul>
            {writable && (
              <div className="border-t border-line p-4">
                <ActionForm action={addAddressAction.bind(null, c.id)} submitLabel="Agregar dirección" resetOnSuccess variant="secondary">
                  <Field label="Calle y número" name="street" required />
                  <Field label="Ciudad" name="city" />
                  <Field label="Estado" name="state" />
                  <Field label="C.P." name="zip" />
                </ActionForm>
              </div>
            )}
          </Card>
          {writable && (
            <Card className="p-4">
              <h2 className="mb-1 text-sm font-semibold">Estado del cliente</h2>
              {c.active ? (
                <ActionForm
                  action={setCustomerActiveAction.bind(null, c.id, false)} submitLabel="Desactivar cliente" variant="secondary"
                  confirmText="Ya no aparecerá para nuevas cotizaciones. Su historial, cotizaciones y ventas se conservan."
                />
              ) : (
                <ActionForm action={setCustomerActiveAction.bind(null, c.id, true)} submitLabel="Reactivar cliente" variant="secondary" />
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
