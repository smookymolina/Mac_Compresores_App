import { can, requirePagePermission } from "@/lib/auth/session";
import { listCustomers } from "@/modules/customers/service";
import { saveQuoteAction } from "@/modules/quotes/actions";
import { Card, PageHeader } from "@/components/ui";
import { QuoteEditor } from "../quote-editor";

export const metadata = { title: "Nueva cotización" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ cliente?: string }> }) {
  const user = await requirePagePermission("quotes.write");
  const { cliente } = await searchParams;
  const customers = await listCustomers(user);
  return (
    <>
      <PageHeader title="Nueva cotización" subtitle="Precios, costos e impuestos se toman del catálogo y se congelan al guardar." />
      <Card className="p-4">
        <QuoteEditor
          action={saveQuoteAction.bind(null, undefined)}
          customers={customers.map((c) => ({ id: c.id, legalName: c.legalName }))}
          initial={cliente ? { customerId: cliente, validUntil: "", notes: "", items: [] } : undefined}
          canOverride={can(user, "quotes.override_price")}
        />
      </Card>
    </>
  );
}
