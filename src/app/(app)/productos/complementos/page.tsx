import type { ComplementPackage } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/session";
import { listPackages } from "@/modules/complements/service";
import { savePackageAction } from "@/modules/complements/actions";
import { warrantyText } from "@/modules/complements/match";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Field, PageHeader } from "@/components/ui";

export const metadata = { title: "Complementos" };

function PackageForm({ p }: { p?: ComplementPackage }) {
  return (
    <ActionForm action={savePackageAction.bind(null, p?.id)} submitLabel={p ? "Guardar cambios" : "Crear paquete"} className="grid gap-3 sm:grid-cols-4">
      <Field label="Clave" name="code" defaultValue={p?.code} required maxLength={40} placeholder="SERV-8000" />
      <div className="sm:col-span-2"><Field label="Nombre" name="name" defaultValue={p?.name} required maxLength={120} placeholder="Servicio de 8000 horas" /></div>
      <Field label="Garantía (meses)" name="warrantyMonths" type="number" min={0} max={60} defaultValue={p?.warrantyMonths ?? 3} required />
      <label className="block sm:col-span-3">
        <span className="label">Actividades (una por renglón)</span>
        <textarea name="activities" rows={6} className="input" defaultValue={p?.activities.join("\n")} placeholder={"Sustitución del filtro de aire\nReporte termográfico"} />
      </label>
      <div className="space-y-3">
        <label className="block">
          <span className="label">Sugerir para SKU o descripción</span>
          <textarea name="skuPatterns" rows={3} className="input" defaultValue={p?.skuPatterns.join("\n")} placeholder={"8000-*\nRenta *"} />
          <span className="text-xs text-ink-soft">Uno por renglón; * = cualquier texto.</span>
        </label>
        <Field label="Orden" name="position" type="number" min={0} max={999} defaultValue={p?.position ?? 0} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="active" defaultChecked={p?.active ?? true} /> Activo</label>
      </div>
    </ActionForm>
  );
}

export default async function ComplementsPage() {
  await requirePagePermission("complements.manage");
  const packages = await listPackages(true);
  return (
    <>
      <PageHeader title="Complementos" subtitle="Paquetes de actividades incluidas que se agregan a las cotizaciones. Los cambios no alteran cotizaciones ya guardadas." />
      <div className="space-y-3">
        {packages.map((p) => (
          <Card key={p.id} className="p-0">
            <details>
              <summary className="tap flex cursor-pointer flex-wrap items-center gap-2 p-4">
                <b>{p.code}</b><span>{p.name}</span>
                <span className="text-xs text-ink-soft">{p.activities.length} actividades · garantía {warrantyText(p.warrantyMonths)}{p.skuPatterns.length > 0 && ` · sugerir: ${p.skuPatterns.join(", ")}`}</span>
                {!p.active && <Badge>Inactivo</Badge>}
              </summary>
              <div className="border-t border-line p-4"><PackageForm p={p} /></div>
            </details>
          </Card>
        ))}
        <Card className="p-0">
          <details open={packages.length === 0}>
            <summary className="tap cursor-pointer p-4 font-medium">+ Nuevo paquete</summary>
            <div className="border-t border-line p-4"><PackageForm /></div>
          </details>
        </Card>
      </div>
    </>
  );
}
