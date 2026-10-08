import Link from "next/link";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getCustomer } from "@/modules/customers/service";
import { addAddressAction, addContactAction } from "@/modules/customers/actions";
import { listSellers } from "@/modules/users/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { ActionForm } from "@/components/action-form";
import { Card, CardHeader, Field, LinkButton, PageHeader, TableWrap } from "@/components/ui";
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
        subtitle={`${c.rfc ?? "Sin RFC"} · Vendedor: ${c.owner?.name ?? "sin asignar"}`}
        actions={can(user, "quotes.write") && <LinkButton href={`/cotizaciones/nueva?cliente=${c.id}`}>Nueva cotización</LinkButton>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {writable && <Card className="p-4"><CustomerForm customer={c} sellers={sellers} /></Card>}
          <Card>
            <CardHeader title="Historial de cotizaciones" />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Folio</th><th>Fecha</th><th>Estado</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {c.quotes.map((q) => (
                    <tr key={q.id}>
                      <td><Link className="font-medium text-accent-fg hover:underline" href={`/cotizaciones/${q.id}`}>C-{q.folio}</Link></td>
                      <td>{fmtDate(q.createdAt)}</td>
                      <td>{QUOTE_STATUS_LABEL[q.status]}</td>
                      <td className="num">{fmtMoney(q.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
          <Card>
            <CardHeader title="Historial de ventas" />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Folio</th><th>Fecha</th><th>Estado</th><th className="num">Total</th></tr></thead>
                <tbody>
                  {c.sales.map((s) => (
                    <tr key={s.id}>
                      <td><Link className="font-medium text-accent-fg hover:underline" href={`/ventas/${s.id}`}>V-{s.folio}</Link></td>
                      <td>{fmtDate(s.confirmedAt)}</td>
                      <td>{s.status === "CONFIRMED" ? "Confirmada" : "Cancelada"}</td>
                      <td className="num">{fmtMoney(s.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title="Contactos" />
            <ul className="divide-y divide-line text-sm">
              {c.contacts.map((ct) => (
                <li key={ct.id} className="px-4 py-2">
                  <p className="font-medium">{ct.name}</p>
                  <p className="text-xs text-ink-soft">{[ct.position, ct.email, ct.phone].filter(Boolean).join(" · ")}</p>
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
              {c.addresses.map((a) => (
                <li key={a.id} className="px-4 py-2">{[a.street, a.city, a.state, a.zip].filter(Boolean).join(", ")}</li>
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
        </div>
      </div>
    </>
  );
}
