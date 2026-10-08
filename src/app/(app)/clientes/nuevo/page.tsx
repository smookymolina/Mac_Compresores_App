import { can, requirePagePermission } from "@/lib/auth/session";
import { Card, PageHeader } from "@/components/ui";
import { listSellers } from "@/modules/users/service";
import { CustomerForm } from "../customer-form";

export const metadata = { title: "Nuevo cliente" };

export default async function NewCustomerPage() {
  const user = await requirePagePermission("customers.write");
  const sellers = can(user, "quotes.read_all") ? await listSellers() : undefined;
  return (
    <>
      <PageHeader title="Nuevo cliente" />
      <Card className="p-4"><CustomerForm sellers={sellers} /></Card>
    </>
  );
}
