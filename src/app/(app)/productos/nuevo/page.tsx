import { requirePagePermission } from "@/lib/auth/session";
import { Card, PageHeader } from "@/components/ui";
import { ProductForm } from "../product-form";

export const metadata = { title: "Nuevo producto" };

export default async function NewProductPage() {
  await requirePagePermission("products.write");
  return (
    <>
      <PageHeader title="Nuevo producto" />
      <Card className="p-4"><ProductForm /></Card>
    </>
  );
}
