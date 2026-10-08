import type { Category, Product } from "@prisma/client";
import { ActionForm } from "@/components/action-form";
import { Field, SelectField } from "@/components/ui";
import { LINE_LABEL, LINES } from "@/modules/products/lines";
import { saveProductAction } from "@/modules/products/actions";

export function ProductForm({ product }: { product?: Product & { category: Category | null } }) {
  return (
    <ActionForm action={saveProductAction.bind(null, product?.id)}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="SKU" name="sku" defaultValue={product?.sku} required />
          <Field className="sm:col-span-2 lg:col-span-3" label="Descripción" name="description" defaultValue={product?.description} required />
          <SelectField label="Línea comercial" name="line" defaultValue={product?.line} options={LINES.map((l) => ({ value: l, label: LINE_LABEL[l] }))} />
          <SelectField label="Tipo" name="kind" defaultValue={product?.kind} options={[{ value: "PRODUCT", label: "Producto (inventariable)" }, { value: "SERVICE", label: "Servicio" }]} />
          <Field label="Categoría" name="category" defaultValue={product?.category?.name} />
          <Field label="Unidad" name="unit" defaultValue={product?.unit ?? "PZA"} required />
          <Field label="Marca OEM" name="oemName" defaultValue={product?.oemName ?? ""} />
          <Field label="No. parte OEM" name="oemPartNumber" defaultValue={product?.oemPartNumber ?? ""} />
          <Field label="Item # / proveedor" name="supplierCode" defaultValue={product?.supplierCode ?? ""} />
          <SelectField label="Estado" name="status" defaultValue={product?.status} options={[{ value: "ACTIVE", label: "Activo" }, { value: "INACTIVE", label: "Inactivo" }]} />
          <Field label="Costo" name="cost" inputMode="decimal" defaultValue={product?.cost.toString() ?? "0"} />
          <Field label="Utilidad (fracción, ej. 0.35)" name="markup" inputMode="decimal" defaultValue={product?.markup.toString() ?? "0"} />
          <Field label="Envío" name="shipping" inputMode="decimal" defaultValue={product?.shipping.toString() ?? "0"} />
          <Field label="Precio venta (vacío = calculado)" name="price" inputMode="decimal" defaultValue={product?.price.toString() ?? ""} />
          <Field label="IVA (fracción)" name="taxRate" inputMode="decimal" defaultValue={product?.taxRate.toString() ?? "0.16"} />
        </div>
    </ActionForm>
  );
}
