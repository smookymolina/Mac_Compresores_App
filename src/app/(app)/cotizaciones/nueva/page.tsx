import { can, requirePagePermission } from "@/lib/auth/session";
import { listCustomers } from "@/modules/customers/service";
import { saveQuoteAction } from "@/modules/quotes/actions";
import { Card, PageHeader } from "@/components/ui";
import { sellerOptions } from "@/modules/quotes/service";
import { QuoteEditor, type EditorItem } from "../quote-editor";
import { db } from "@/lib/db";
import { currentExchangeRate } from "@/modules/products/service";
import { catalogPriceMxn } from "@/modules/quotes/pricing";
import { packageOptions } from "@/modules/complements/service";

export const metadata = { title: "Nueva cotización" };

export default async function NewQuotePage({ searchParams }: { searchParams: Promise<{ cliente?: string; producto?: string }> }) {
  const user = await requirePagePermission("quotes.write");
  const { cliente, producto } = await searchParams;
  const customers = await listCustomers(user);
  // Desde la lista de precios: la cotización arranca con el producto elegido.
  const fx = (await currentExchangeRate())?.rate ?? null;
  const p = producto && /^[0-9a-f-]{36}$/i.test(producto)
    ? await db.product.findFirst({ where: { id: producto, status: "ACTIVE" } }) : null;
  const items: EditorItem[] = p && !(p.currency === "USD" && !fx) ? [{
    productId: p.id, sku: p.sku, description: p.description, unit: p.unit,
    listPrice: catalogPriceMxn(p, fx).toString(), taxRate: p.taxRate.toString(), quantity: "1", discountPct: "0",
    unitPrice: "", details: "", priceUsd: p.currency === "USD" ? p.price.toString() : null,
  }] : [];
  return (
    <>
      <PageHeader title="Nueva cotización" subtitle="Precios, costos e impuestos se toman del catálogo y se congelan al guardar." />
      <Card className="p-4">
        <QuoteEditor
          action={saveQuoteAction.bind(null, undefined)}
          customers={customers.map((c) => ({ id: c.id, legalName: c.legalName }))}
          initial={cliente || items.length ? { customerId: cliente ?? "", validUntil: "", notes: "", complements: null, items } : undefined}
          canOverride={can(user, "quotes.override_price")}
          complementOptions={await packageOptions(user)}
          canCustomize={can(user, "complements.manage")}
          sellers={can(user, "quotes.assign_seller") ? await sellerOptions() : undefined}
          defaultSellerId={user.id}
          canApproveDiscount={can(user, "quotes.approve_discount")}
        />
      </Card>
    </>
  );
}
