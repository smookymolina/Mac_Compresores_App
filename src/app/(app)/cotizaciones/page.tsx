import Link from "next/link";
import type { QuoteStatus } from "@prisma/client";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listQuotes } from "@/modules/quotes/service";
import { QUOTE_STATUS_LABEL } from "@/modules/quotes/status";
import { Card, EmptyState, LinkButton, PageHeader, TableWrap } from "@/components/ui";
import { QuoteStatusBadge } from "./status-badge";
import { fmtMoney } from "@/lib/money";
import { fmtDate, sp } from "@/lib/utils";

export const metadata = { title: "Cotizaciones" };

export default async function QuotesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string }> }) {
  const user = await requirePagePermission("quotes.read_all", "quotes.read_own");
  const p = await searchParams;
  const status = p.status && p.status in QUOTE_STATUS_LABEL ? (p.status as QuoteStatus) : undefined;
  const rows = await listQuotes(user, { status, search: sp(p.q) });

  return (
    <>
      <PageHeader title="Cotizaciones" actions={can(user, "quotes.write") && <LinkButton href="/cotizaciones/nueva">Nueva cotización</LinkButton>} />
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-line p-3">
          <input name="q" defaultValue={p.q} placeholder="Folio o cliente" className="input max-w-xs" />
          <select name="status" defaultValue={status ?? ""} className="input max-w-48">
            <option value="">Todos los estados</option>
            {Object.entries(QUOTE_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button className="rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50">Filtrar</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="Sin cotizaciones" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Folio</th><th>Cliente</th><th>Vendedor</th><th>Fecha</th><th>Vigencia</th><th>Estado</th><th className="num">Total</th></tr></thead>
              <tbody>
                {rows.map((q) => (
                  <tr key={q.id}>
                    <td><Link className="text-brand hover:underline" href={`/cotizaciones/${q.id}`}>C-{q.folio}</Link></td>
                    <td>{q.customer.legalName}</td>
                    <td>{q.seller.name}</td>
                    <td>{fmtDate(q.createdAt)}</td>
                    <td>{fmtDate(q.validUntil)}</td>
                    <td><QuoteStatusBadge status={q.status} /></td>
                    <td className="num">{fmtMoney(q.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
