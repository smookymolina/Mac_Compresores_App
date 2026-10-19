import { useState } from "react";
import { fmtDate } from "@domain/format";
import { quoteFolioLabel, useApp, type EntityRow, type LocalQuote } from "../core";
import { Alert, Badge, Button, Card, Empty, Facts, Loading, SearchBox, useAsync, useDebounced } from "../ui/kit";
import { money, quoteStatus, quoteTotal, saleStatus, str } from "../ui/format";

const PAGE = 50;

export function CustomerList({ onOpen }: { onOpen: (id: string) => void }) {
  const { controller, lastSyncAt } = useApp();
  const store = controller.store;
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [limit, setLimit] = useState(PAGE);
  const rows = useAsync(
    () => (dq ? store.search<EntityRow>("Customer", dq, limit) : store.list<"Customer", EntityRow>("Customer", { orderBy: "legalName", limit })),
    [dq, limit, lastSyncAt],
  );
  const items = rows.data ?? [];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-2 pt-1">
        <SearchBox label="Buscar cliente" placeholder="Razón social, RFC, correo o teléfono" value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} />
      </div>
      {rows.error && <Alert>{rows.error}</Alert>}
      {rows.loading && !rows.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title={dq ? "Sin resultados" : "Sin clientes"}>{dq ? `No hay clientes que coincidan con «${dq}».` : "No tienes clientes asignados en este teléfono."}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen(c.id)} className="block min-h-11 w-full px-4 py-3 text-left hover:bg-panel-2">
                <span className="block truncate font-medium text-ink">{str(c.legalName)}</span>
                <span className="flex items-center gap-2 text-sm text-muted">
                  <span className="truncate">{[str(c.rfc), str(c.phone)].filter(Boolean).join(" · ") || "—"}</span>
                  {c.active === false && <Badge tone="warn">Inactivo</Badge>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length >= limit && <Button variant="secondary" className="w-full" busy={rows.loading} onClick={() => setLimit((l) => l + PAGE)}>Mostrar {PAGE} más</Button>}
    </div>
  );
}

type Contact = { id: string; name: string; position?: string | null; email?: string | null; phone?: string | null };
type Address = { id: string; label: string; street: string; city?: string | null; state?: string | null; zip?: string | null };

const tel = (v: string | null) => (v ? <a className="text-accent-fg underline" href={`tel:${v.replace(/[^\d+]/g, "")}`}>{v}</a> : null);
const mail = (v: string | null) => (v ? <a className="break-all text-accent-fg underline" href={`mailto:${v}`}>{v}</a> : null);

export function CustomerDetail({ id, onOpenQuote, onNewQuote }: { id: string; onOpenQuote: (id: string) => void; onNewQuote: (customerId: string) => void }) {
  const { controller, lastSyncAt, canCapture } = useApp();
  const store = controller.store;
  const r = useAsync(async () => {
    const [c, quotes, sales] = await Promise.all([
      store.get("Customer", id),
      store.list<"Quote", LocalQuote>("Quote", { where: { customerId: id }, orderBy: "updatedAt", desc: true }),
      store.list<"Sale", EntityRow>("Sale", { where: { customerId: id }, orderBy: "folio", desc: true }),
    ]);
    return { c, quotes, sales };
  }, [id, lastSyncAt]);

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <Alert>{r.error}</Alert>;
  const c = r.data?.c;
  if (!c) return <Empty title="Cliente no encontrado">Puede que se haya reasignado a otro vendedor.</Empty>;
  const contacts = (c.contacts as Contact[] | undefined) ?? [];
  const addresses = (c.addresses as Address[] | undefined) ?? [];
  const { quotes, sales } = r.data!;

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-ink">{str(c.legalName)}</h1>
        {c.active === false && <div className="mt-1"><Badge tone="warn">Inactivo</Badge></div>}
      </div>
      <Button className="w-full" disabled={!canCapture || c.active === false} onClick={() => onNewQuote(c.id)}>Nueva cotización</Button>
      {!canCapture && <p className="text-xs text-warn">Sincroniza para volver a cotizar.</p>}
      <Card title="Datos">
        <Facts rows={[
          ["RFC", str(c.rfc)],
          ["Correo", mail(str(c.email))],
          ["Teléfono", tel(str(c.phone))],
          ["Días de crédito", str(c.paymentTermsDays)],
          ["Límite de crédito", c.creditLimit ? money(c.creditLimit) : null],
          ["Notas", str(c.notes)],
        ]} />
      </Card>
      <Card title={`Contactos (${contacts.length})`}>
        {contacts.length === 0 ? <p className="text-sm text-muted">Sin contactos.</p> : (
          <ul className="divide-y divide-line text-sm">
            {contacts.map((k) => (
              <li key={k.id} className="py-2">
                <p className="font-medium text-ink">{k.name}{k.position ? <span className="font-normal text-muted"> · {k.position}</span> : null}</p>
                <p className="flex flex-wrap gap-x-3">{tel(k.phone ?? null)}{mail(k.email ?? null)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Direcciones (${addresses.length})`}>
        {addresses.length === 0 ? <p className="text-sm text-muted">Sin direcciones.</p> : (
          <ul className="divide-y divide-line text-sm">
            {addresses.map((a) => (
              <li key={a.id} className="py-2">
                <p className="font-medium text-ink">{a.label}</p>
                <p className="text-ink-soft">{[a.street, a.city, a.state, a.zip && `C.P. ${a.zip}`].filter(Boolean).join(", ")}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Cotizaciones (${quotes.length})`}>
        {quotes.length === 0 ? <p className="text-sm text-muted">Sin cotizaciones.</p> : (
          <ul className="divide-y divide-line text-sm">
            {quotes.map((q) => (
              <li key={q.id}>
                <button type="button" onClick={() => onOpenQuote(q.id)} className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left">
                <span className="min-w-0">
                  <span className="font-medium text-accent-fg">{quoteFolioLabel(q)}</span>
                  <span className="block text-muted">{quoteStatus(q.status)}{q.createdAt ? ` · ${fmtDate(String(q.createdAt))}` : ""}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-ink">{quoteTotal(q as unknown as Record<string, unknown>)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Ventas (${sales.length})`}>
        {sales.length === 0 ? <p className="text-sm text-muted">Sin ventas.</p> : (
          <ul className="divide-y divide-line text-sm">
            {sales.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="font-medium text-ink">V-{str(s.folio)}</span>
                  <span className="block text-muted">{saleStatus(s.status)}{s.confirmedAt ? ` · ${fmtDate(String(s.confirmedAt))}` : ""}</span>
                </span>
                <span className="shrink-0 font-medium tabular-nums text-ink">{money(s.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
