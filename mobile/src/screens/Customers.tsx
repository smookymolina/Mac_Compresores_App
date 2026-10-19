import { useState } from "react";
import { fmtDate } from "@domain/format";
import { isPendingSale, quoteFolioLabel, saleFolioLabel, useApp, type EntityRow, type LocalCustomer, type LocalQuote, type LocalSale } from "../core";
import { Alert, Badge, Button, Card, Confirm, Empty, Facts, Field, INPUT, Loading, SearchBox, errMsg, useAsync, useDebounced } from "../ui/kit";
import { money, quoteStatus, quoteTotal, saleStatus, str } from "../ui/format";
import { SyncStateBadge, SyncNotice } from "../ui/sync";

const PAGE = 50;

export function CustomerList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { controller, lastSyncAt, pendingCount, can, canCapture } = useApp();
  const store = controller.store;
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [limit, setLimit] = useState(PAGE);
  const rows = useAsync(
    () => (dq ? store.search<EntityRow>("Customer", dq, limit) : store.list<"Customer", EntityRow>("Customer", { orderBy: "legalName", limit })),
    [dq, limit, lastSyncAt, pendingCount],
  );
  const items = rows.data ?? [];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-2 pt-1">
        <SearchBox label="Buscar cliente" placeholder="Razón social, RFC, correo o teléfono" value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} />
      </div>
      {can("customers.write") && <Button className="w-full" disabled={!canCapture} onClick={onNew}>Nuevo cliente</Button>}
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
                  <SyncStateBadge sync={(c as LocalCustomer)._sync} short />
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

const tel = (v: string | null) => (v ? <a className="text-accent-fg underline" href={`tel:${v.replace(/[^\d+]/g, "")}`}>{v}</a> : null);
const mail = (v: string | null) => (v ? <a className="break-all text-accent-fg underline" href={`mailto:${v}`}>{v}</a> : null);

type Ask = { kind: "contact" | "address"; id: string; name: string } | null;

export function CustomerDetail({ id, notice, onOpenQuote, onNewQuote, onOpenSale, onEdit }: {
  id: string; notice?: string; onOpenQuote: (id: string) => void; onNewQuote: (customerId: string) => void; onOpenSale: (id: string) => void; onEdit: (id: string) => void;
}) {
  const app = useApp();
  const { controller, lastSyncAt, canCapture, pendingCount, issues } = app;
  const store = controller.store;
  const r = useAsync(async () => {
    const [c, quotes, sales] = await Promise.all([
      app.customers.getCustomer(id),
      store.list<"Quote", LocalQuote>("Quote", { where: { customerId: id }, orderBy: "updatedAt", desc: true }),
      app.sales.listSales({ customerId: id }),
    ]);
    return { c, quotes, sales };
  }, [id, lastSyncAt, pendingCount, issues]);
  const [form, setForm] = useState<"contact" | "address" | null>(null);
  const [ask, setAsk] = useState<Ask>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <Alert>{r.error}</Alert>;
  const c = r.data?.c;
  if (!c) return <Empty title="Cliente no encontrado">Puede que se haya reasignado a otro vendedor.</Empty>;
  const contacts = c.contacts ?? [];
  const addresses = c.addresses ?? [];
  const { quotes, sales } = r.data!;
  const writable = app.can("customers.write") && canCapture;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ tone: "ok", text: ok }); r.reload(); return true; }
    catch (e) { setMsg({ tone: "danger", text: errMsg(e) }); return false; }
    finally { setBusy(false); }
  }
  async function remove() {
    const a = ask; setAsk(null);
    if (!a) return;
    await run(() => (a.kind === "contact" ? app.customers.removeContact(id, a.id) : app.customers.removeAddress(id, a.id)), `${a.kind === "contact" ? "Contacto" : "Dirección"} eliminado. Se enviará al sincronizar.`);
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-ink">{c.legalName}</h1>
        <div className="mt-1 flex flex-wrap gap-2">
          {c.active === false && <Badge tone="warn">Inactivo</Badge>}
          <SyncStateBadge sync={c._sync} />
        </div>
      </div>
      {notice && <Alert tone="ok">{notice}</Alert>}
      <SyncNotice sync={c._sync} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {app.can("quotes.write") && <Button className="w-full" disabled={!canCapture || c.active === false} onClick={() => onNewQuote(c.id)}>Nueva cotización</Button>}
      {app.can("customers.write") && <Button variant="secondary" className="w-full" disabled={!canCapture} onClick={() => onEdit(c.id)}>Editar</Button>}
      {!canCapture && <p className="text-xs text-warn">Sincroniza para volver a capturar.</p>}
      <Card title="Datos">
        <Facts rows={[
          ["RFC", c.rfc],
          ["Correo", mail(c.email)],
          ["Teléfono", tel(c.phone)],
          ["Días de crédito", str(c.paymentTermsDays)],
          ["Límite de crédito", c.creditLimit ? money(c.creditLimit) : null],
          ["Notas", c.notes],
        ]} />
      </Card>
      <Card title={`Contactos (${contacts.length})`}>
        {contacts.length === 0 ? <p className="text-sm text-muted">Sin contactos.</p> : (
          <ul className="divide-y divide-line text-sm">
            {contacts.map((k) => (
              <li key={k.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{k.name}{k.position ? <span className="font-normal text-muted"> · {k.position}</span> : null}</p>
                  <p className="flex flex-wrap gap-x-3">{tel(k.phone)}{mail(k.email)}</p>
                  <SyncStateBadge sync={k._sync} short />
                </div>
                {writable && <Button variant="ghost" className="shrink-0 px-3 text-sm text-danger" aria-label={`Quitar contacto ${k.name}`} onClick={() => setAsk({ kind: "contact", id: k.id, name: k.name })}>Quitar</Button>}
              </li>
            ))}
          </ul>
        )}
        {writable && (form === "contact"
          ? <ContactForm busy={busy} onCancel={() => setForm(null)} onSave={async (v) => { if (await run(() => app.customers.addContact(id, v), "Contacto agregado. Se enviará al sincronizar.")) setForm(null); }} />
          : <Button variant="secondary" className="mt-2 w-full" onClick={() => { setForm("contact"); setMsg(null); }}>Agregar contacto</Button>)}
      </Card>
      <Card title={`Direcciones (${addresses.length})`}>
        {addresses.length === 0 ? <p className="text-sm text-muted">Sin direcciones.</p> : (
          <ul className="divide-y divide-line text-sm">
            {addresses.map((a) => (
              <li key={a.id} className="flex items-start justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{a.label}</p>
                  <p className="text-ink-soft">{[a.street, a.city, a.state, a.zip && `C.P. ${a.zip}`].filter(Boolean).join(", ")}</p>
                  <SyncStateBadge sync={a._sync} short />
                </div>
                {writable && <Button variant="ghost" className="shrink-0 px-3 text-sm text-danger" aria-label={`Quitar dirección ${a.street}`} onClick={() => setAsk({ kind: "address", id: a.id, name: a.street })}>Quitar</Button>}
              </li>
            ))}
          </ul>
        )}
        {writable && (form === "address"
          ? <AddressForm busy={busy} onCancel={() => setForm(null)} onSave={async (v) => { if (await run(() => app.customers.addAddress(id, v), "Dirección agregada. Se enviará al sincronizar.")) setForm(null); }} />
          : <Button variant="secondary" className="mt-2 w-full" onClick={() => { setForm("address"); setMsg(null); }}>Agregar dirección</Button>)}
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
            {sales.map((s: LocalSale) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpenSale(s.id)} className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left">
                  <span className="min-w-0">
                    <span className="font-medium text-accent-fg">{saleFolioLabel(s)}</span>
                    <span className="block text-muted">{isPendingSale(s) ? "Por confirmar" : saleStatus(s.status)}{s.confirmedAt ? ` · ${fmtDate(String(s.confirmedAt))}` : ""}</span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums text-ink">{money(s.total)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Confirm
        open={ask !== null}
        title={ask?.kind === "contact" ? "¿Quitar contacto?" : "¿Quitar dirección?"}
        body={<>Se quitará «{ask?.name}» de {c.legalName}. Se enviará al sincronizar.</>}
        confirmLabel="Quitar"
        onCancel={() => setAsk(null)}
        onConfirm={() => void remove()}
      />
    </div>
  );
}

type ContactValues = { name: string; position: string; email: string; phone: string };
type AddressValues = { street: string; city: string; state: string; zip: string };

function ContactForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (v: ContactValues) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<ContactValues>({ name: "", position: "", email: "", phone: "" });
  const set = (k: keyof ContactValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="mt-3 space-y-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); void onSave(v); }}>
      <Field label="Nombre" name="ct-name" required minLength={2} maxLength={120} value={v.name} onChange={set("name")} />
      <Field label="Puesto" name="ct-position" value={v.position} onChange={set("position")} />
      <Field label="Correo" name="ct-email" type="email" autoComplete="off" value={v.email} onChange={set("email")} />
      <Field label="Teléfono" name="ct-phone" type="tel" value={v.phone} onChange={set("phone")} />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className="flex-1" busy={busy}>Agregar</Button>
      </div>
    </form>
  );
}

function AddressForm({ busy, onSave, onCancel }: { busy: boolean; onSave: (v: AddressValues) => Promise<void>; onCancel: () => void }) {
  const [v, setV] = useState<AddressValues>({ street: "", city: "", state: "", zip: "" });
  const set = (k: keyof AddressValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="mt-3 space-y-3 border-t border-line pt-3" onSubmit={(e) => { e.preventDefault(); void onSave(v); }}>
      <Field label="Calle y número" name="ad-street" required minLength={3} maxLength={300} value={v.street} onChange={set("street")} />
      <Field label="Ciudad" name="ad-city" value={v.city} onChange={set("city")} />
      <Field label="Estado" name="ad-state" value={v.state} onChange={set("state")} />
      <Field label="C.P." name="ad-zip" inputMode="numeric" maxLength={5} value={v.zip} onChange={set("zip")} />
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className="flex-1" busy={busy}>Agregar</Button>
      </div>
    </form>
  );
}

// ---------- Alta / edición ----------

type FormValues = {
  legalName: string; rfc: string; email: string; phone: string; paymentTermsDays: string; creditLimit: string; notes: string;
  contactName: string; contactEmail: string; contactPhone: string; street: string; city: string; state: string; zip: string;
};
type FieldKey = "legalName" | "rfc" | "email" | "paymentTermsDays" | "creditLimit" | "notes";
const EMPTY: FormValues = { legalName: "", rfc: "", email: "", phone: "", paymentTermsDays: "0", creditLimit: "", notes: "", contactName: "", contactEmail: "", contactPhone: "", street: "", city: "", state: "", zip: "" };

/** Ubica el mensaje del servicio en su campo (mismas reglas que la web). */
function fieldOf(message: string): FieldKey | null {
  if (/raz[oó]n social/i.test(message)) return "legalName";
  if (/RFC/.test(message)) return "rfc";
  if (/^Correo/i.test(message)) return "email";
  if (/D[ií]as de cr[eé]dito/i.test(message)) return "paymentTermsDays";
  if (/L[ií]mite de cr[eé]dito/i.test(message)) return "creditLimit";
  return null;
}

export function CustomerForm({ id, onSaved, onCancel }: { id?: string; onSaved: (id: string, notice: string) => void; onCancel: () => void }) {
  const app = useApp();
  const r = useAsync(async () => (id ? app.customers.getCustomer(id) : null), [id]);
  if (!app.can("customers.write")) return <Empty title="Sin permiso">No tienes permiso para capturar clientes.</Empty>;
  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <Alert>{r.error}</Alert>;
  if (id && !r.data) return <Empty title="Cliente no encontrado" />;
  const c = r.data;
  const initial: FormValues = c
    ? { ...EMPTY, legalName: c.legalName, rfc: c.rfc ?? "", email: c.email ?? "", phone: c.phone ?? "", paymentTermsDays: String(c.paymentTermsDays ?? 0), creditLimit: c.creditLimit ?? "", notes: c.notes ?? "" }
    : EMPTY;
  return <CustomerFormBody key={id ?? "new"} id={id} initial={initial} onSaved={onSaved} onCancel={onCancel} />;
}

function CustomerFormBody({ id, initial, onSaved, onCancel }: { id?: string; initial: FormValues; onSaved: (id: string, notice: string) => void; onCancel: () => void }) {
  const app = useApp();
  const [v, setV] = useState<FormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: FieldKey | null; text: string } | null>(null);
  const set = (k: keyof FormValues) => (e: { target: { value: string } }) => setV((x) => ({ ...x, [k]: e.target.value }));
  const fe = (k: FieldKey) => (err?.field === k ? err.text : null);

  async function submit() {
    setBusy(true); setErr(null);
    const days = v.paymentTermsDays.trim() === "" ? 0 : Number(v.paymentTermsDays);
    const fields = { legalName: v.legalName, rfc: v.rfc, email: v.email, phone: v.phone, paymentTermsDays: days, creditLimit: v.creditLimit, notes: v.notes };
    try {
      if (id) {
        await app.customers.updateCustomer(id, fields);
        onSaved(id, "Cambios guardados en el teléfono; se enviarán al sincronizar.");
      } else {
        const hasContact = [v.contactName, v.contactEmail, v.contactPhone].some((x) => x.trim());
        const hasAddress = [v.street, v.city, v.state, v.zip].some((x) => x.trim());
        const row = await app.customers.createCustomer({
          ...fields,
          ...(hasContact && { contact: { name: v.contactName, email: v.contactEmail, phone: v.contactPhone } }),
          ...(hasAddress && { address: { street: v.street, city: v.city, state: v.state, zip: v.zip } }),
        });
        onSaved(row.id, "Cliente guardado en el teléfono; se enviará al sincronizar.");
      }
    } catch (e) {
      const text = errMsg(e);
      setErr({ field: fieldOf(text), text });
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <h1 className="text-lg font-semibold text-ink">{id ? "Editar cliente" : "Nuevo cliente"}</h1>
      {!app.canCapture && <Alert tone="warn">Solo consulta: sincroniza para volver a capturar.</Alert>}
      {err && !err.field && <Alert>{err.text}</Alert>}
      <Card title="Datos">
        <div className="space-y-3">
          <Field label="Razón social" name="legalName" required maxLength={200} value={v.legalName} onChange={set("legalName")} error={fe("legalName")} />
          <Field label="RFC" name="rfc" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={13} value={v.rfc} onChange={set("rfc")} error={fe("rfc")} hint="12 o 13 caracteres. Opcional." />
          <Field label="Condiciones de pago (días)" name="paymentTermsDays" type="number" inputMode="numeric" min={0} max={365} value={v.paymentTermsDays} onChange={set("paymentTermsDays")} error={fe("paymentTermsDays")} />
          <Field label="Correo" name="email" type="email" autoComplete="email" value={v.email} onChange={set("email")} error={fe("email")} />
          <Field label="Teléfono" name="phone" type="tel" autoComplete="tel" value={v.phone} onChange={set("phone")} />
          <Field label="Límite de crédito" name="creditLimit" inputMode="decimal" value={v.creditLimit} onChange={set("creditLimit")} error={fe("creditLimit")} />
          <label className="block" htmlFor="cust-notes">
            <span className="mb-1 block text-sm font-medium text-ink-soft">Notas</span>
            <textarea id="cust-notes" rows={2} maxLength={2000} className={`${INPUT} py-2`} value={v.notes} onChange={set("notes")} />
          </label>
        </div>
      </Card>
      {!id && (
        <Card title="Contacto y dirección (opcional)">
          <div className="space-y-3">
            <Field label="Contacto principal" name="contactName" value={v.contactName} onChange={set("contactName")} />
            <Field label="Correo del contacto" name="contactEmail" type="email" autoComplete="off" value={v.contactEmail} onChange={set("contactEmail")} />
            <Field label="Teléfono del contacto" name="contactPhone" type="tel" value={v.contactPhone} onChange={set("contactPhone")} />
            <Field label="Dirección" name="street" value={v.street} onChange={set("street")} />
            <Field label="Ciudad" name="city" value={v.city} onChange={set("city")} />
            <Field label="Estado" name="state" value={v.state} onChange={set("state")} />
            <Field label="C.P." name="zip" inputMode="numeric" maxLength={5} value={v.zip} onChange={set("zip")} />
          </div>
        </Card>
      )}
      {err?.field && <Alert>{err.text}</Alert>}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" className="flex-1" busy={busy} disabled={!app.canCapture}>Guardar</Button>
      </div>
    </form>
  );
}
