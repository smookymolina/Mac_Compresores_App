import { requirePagePermission } from "@/lib/auth/session";
import { Card, PageHeader } from "@/components/ui";
import { ImportForm } from "./import-form";

export const metadata = { title: "Importar productos" };

export default async function ImportPage() {
  await requirePagePermission("products.import");
  return (
    <>
      <PageHeader
        title="Importar lista de precios"
        subtitle="CSV UTF-8 exportado de la hoja “Lista precios” (o con columnas SKU, Descripción, Type, Costo, Utilidad, Envio, Precio venta, IVA)."
      />
      <Card className="p-4 text-sm">
        <ul className="mb-4 list-disc space-y-1 pl-5 text-ink-soft">
          <li>Columna <b>Type</b>: REFACCIONES, KIT’S, VENTA, SERVICIOS, TUBERIA, RENTA u OTROS (define la línea de comisión).</li>
          <li>Sin columna SKU se genera como <code>MARCA OEM-No. parte OEM</code>.</li>
          <li>Si “Precio venta” está vacío se calcula: costo × (1 + utilidad) + envío. Un precio 0 no puede cotizarse sin autorización.</li>
          <li>Productos existentes (mismo SKU) se actualizan y el cambio queda en el historial de precios.</li>
        </ul>
        <ImportForm />
      </Card>
    </>
  );
}
