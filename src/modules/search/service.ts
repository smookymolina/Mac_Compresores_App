import "server-only";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/session";
import { customerScope } from "@/modules/customers/service";
import { quoteScope } from "@/modules/quotes/service";
import { saleScope } from "@/modules/sales/service";

export interface SearchHit { group: string; title: string; detail?: string; href: string }

const TAKE = 5;

/** Búsqueda global: clientes, productos, cotizaciones y ventas, respetando permisos y alcance por objeto. */
export async function globalSearch(user: CurrentUser, raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const folio = /^[cv]?-?\d+$/i.test(q) ? Number(q.replace(/\D/g, "")) : undefined;
  const text = { contains: q, mode: "insensitive" as const };

  const [customers, products, quotes, sales] = await Promise.all([
    can(user, "customers.read")
      ? db.customer.findMany({ where: { AND: [customerScope(user), { OR: [{ legalName: text }, { rfc: text }] }] }, select: { id: true, legalName: true, rfc: true }, take: TAKE, orderBy: { legalName: "asc" } })
      : [],
    can(user, "products.read")
      ? db.product.findMany({ where: { status: "ACTIVE", OR: [{ sku: text }, { description: text }, { oemPartNumber: text }] }, select: { id: true, sku: true, description: true }, take: TAKE, orderBy: { sku: "asc" } })
      : [],
    can(user, "quotes.read_all") || can(user, "quotes.read_own")
      ? db.quote.findMany({
          where: { AND: [quoteScope(user), { OR: [...(folio ? [{ folio }] : []), { customer: { legalName: text } }] }] },
          select: { id: true, folio: true, customer: { select: { legalName: true } } }, take: TAKE, orderBy: { createdAt: "desc" },
        })
      : [],
    can(user, "sales.read_all") || can(user, "sales.read_own")
      ? db.sale.findMany({
          where: { AND: [saleScope(user), { OR: [...(folio ? [{ folio }] : []), { customer: { legalName: text } }] }] },
          select: { id: true, folio: true, customer: { select: { legalName: true } } }, take: TAKE, orderBy: { confirmedAt: "desc" },
        })
      : [],
  ]);

  return [
    ...quotes.map((x) => ({ group: "Cotizaciones", title: `C-${x.folio}`, detail: x.customer.legalName, href: `/cotizaciones/${x.id}` })),
    ...sales.map((x) => ({ group: "Ventas", title: `V-${x.folio}`, detail: x.customer.legalName, href: `/ventas/${x.id}` })),
    ...customers.map((x) => ({ group: "Clientes", title: x.legalName, detail: x.rfc ?? undefined, href: `/clientes/${x.id}` })),
    ...products.map((x) => ({ group: "Productos", title: x.sku, detail: x.description, href: `/productos/${x.id}` })),
  ];
}
