import type { Customer } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { Field, SelectField } from "@/components/ui";
import { saveCustomerAction } from "@/modules/customers/actions";

export function CustomerForm({
  customer, sellers,
}: {
  customer?: Customer;
  sellers?: { id: string; name: string }[]; // solo para gerencia/admin
}) {
  return (
    <ActionForm action={saveCustomerAction.bind(null, customer?.id)}>
      {(e) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field className="sm:col-span-2" label="Razón social" name="legalName" defaultValue={customer?.legalName} required error={e?.legalName} />
            <Field label="RFC" name="rfc" defaultValue={customer?.rfc ?? ""} error={e?.rfc} />
            <Field label="Condiciones de pago (días)" name="paymentTermsDays" type="number" min={0} defaultValue={customer?.paymentTermsDays ?? 0} error={e?.paymentTermsDays} />
            <Field label="Correo" name="email" type="email" defaultValue={customer?.email ?? ""} error={e?.email} />
            <Field label="Teléfono" name="phone" defaultValue={customer?.phone ?? ""} />
            <Field label="Límite de crédito" name="creditLimit" inputMode="decimal" defaultValue={customer?.creditLimit?.toString() ?? ""} error={e?.creditLimit} />
            {sellers && (
              <SelectField label="Vendedor asignado" name="ownerId" defaultValue={customer?.ownerId ?? ""}
                options={[{ value: "", label: "Sin asignar" }, ...sellers.map((s) => ({ value: s.id, label: s.name }))]} />
            )}
          </div>
          <div>
            <label className="label" htmlFor="notes">Notas comerciales</label>
            <textarea id="notes" name="notes" rows={2} className="input" defaultValue={customer?.notes ?? ""} />
          </div>
          {!customer && (
            <div className="grid gap-3 border-t border-line pt-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Contacto principal" name="contactName" />
              <Field label="Correo del contacto" name="contactEmail" type="email" />
              <Field label="Teléfono del contacto" name="contactPhone" />
              <span />
              <Field className="sm:col-span-2" label="Dirección" name="street" />
              <Field label="Ciudad" name="city" />
              <Field label="Estado" name="state" />
            </div>
          )}
        </>
      )}
    </ActionForm>
  );
}
