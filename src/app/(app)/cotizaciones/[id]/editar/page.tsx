import { notFound, redirect } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { listCustomers } from "@/modules/customers/service";
import { getQuote } from "@/modules/quotes/service";
import { saveQuoteAction } from "@/modules/quotes/actions";
import { Card, PageHeader } from "@/components/ui";
import { QuoteEditor } from "../../quote-editor";

export default async function EditQuotePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("quotes.write");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const q = await getQuote(user, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  if (q.status !== "DRAFT") redirect(`/cotizaciones/${id}`);
  const customers = await listCustomers(user);
  const overridden = (listPrice: string, unitPrice: string) => (listPrice === unitPrice ? "" : unitPrice);

  // Al editar, cada partida vuelve a tomar el precio vigente del catálogo (salvo precio especial autorizado).
  const products = new Map(
    (
      await db.product.findMany({
        where: { id: { in: q.items.map((i) => i.productId).filter((x): x is string => !!x) } },
        select: { id: true, price: true, taxRate: true },
      })
    ).map((p) => [p.id, p]),
  );

  return (
    <>
      <PageHeader title={`Editar C-${q.folio}`} />
      <Card className="p-4">
        <QuoteEditor
          action={saveQuoteAction.bind(null, q.id)}
          customers={customers.map((c) => ({ id: c.id, legalName: c.legalName }))}
          canOverride={can(user, "quotes.override_price")}
          initial={{
            customerId: q.customerId,
            validUntil: q.validUntil.toISOString().slice(0, 10),
            notes: q.notes ?? "",
            items: q.items
              .filter((i) => i.productId)
              .map((i) => {
                const cur = products.get(i.productId!);
                const list = (cur?.price ?? i.unitPrice).toString();
                return {
                  productId: i.productId!, sku: i.sku, description: i.description, unit: i.unit,
                  listPrice: list, taxRate: (cur?.taxRate ?? i.taxRate).toString(), quantity: i.quantity.toString(),
                  discountPct: i.discountPct.mul(100).toString(), unitPrice: overridden(list, i.unitPrice.toString()),
                };
              }),
          }}
        />
      </Card>
    </>
  );
}
