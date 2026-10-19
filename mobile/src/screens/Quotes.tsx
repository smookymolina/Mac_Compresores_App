import { useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { fmtDate } from "@domain/format";
import { dec, round2 } from "@domain/money";
import { QUOTE_STATUS_LABEL, QUOTE_TRANSITIONS } from "@domain/quote-status";
import { MAX_DISCOUNT_WITHOUT_OVERRIDE } from "@domain/rules";
import { suggestFor, warrantyText, type ComplementOption } from "@domain/complements";
import type { QuoteStatus } from "@domain/types";
import {
  isProvisional, quoteFolioLabel, quoteToInput, useApp,
  type EntityRow, type LocalQuote, type PriceConflict, type QuoteComplementInput, type QuoteInput, type SyncConfig,
} from "../core";
import { Alert, Badge, Button, Card, Confirm, Empty, Facts, Field, Loading, SearchBox, useAsync, useDebounced } from "../ui/kit";
import { money, qty, quoteStatus, str } from "../ui/format";

const PAGE = 50;
const INPUT = "min-h-11 w-full rounded-md border border-[var(--border-input)] bg-panel px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none";
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Ocurrió un error.");
const STATUSES = Object.keys(QUOTE_STATUS_LABEL) as QuoteStatus[];

/** Monto guardado en MXN mostrado en la moneda de la cotización. */
function amount(v: unknown, currency: string, fx: unknown): string {
  const r = fx ? dec(fx as string) : null;
  if (currency === "USD" && r && r.gt(0)) return money(round2(dec(v as string).div(r)), "USD");
  return money(v, "MXN");
}

export function SyncBadge({ q }: { q: LocalQuote }) {
  const s = q._sync?.state;
  if (s === "pending") return <Badge tone="warn">Pendiente de sincronizar</Badge>;
  if (s === "conflict") return <Badge tone="info">En revisión</Badge>;
  if (s === "rejected") return <Badge tone="danger">Rechazada por el servidor</Badge>;
  return null;
}

function FolioLabel({ q, className = "" }: { q: LocalQuote; className?: string }) {
  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      <span className="font-mono">{quoteFolioLabel(q)}</span>
      {isProvisional(q) && <Badge tone="neutral">Folio provisional</Badge>}
    </span>
  );
}

// ---------- Lista ----------

export function QuoteList({ onOpen, onNew }: { onOpen: (id: string) => void; onNew: () => void }) {
  const { quotes, lastSyncAt, pendingCount, conflicts, canCapture } = useApp();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [status, setStatus] = useState<QuoteStatus | "">("");
  const [limit, setLimit] = useState(PAGE);
  // «C-123» → «123» (el folio se indexa como número).
  const term = /^c-?\d+$/i.test(dq) ? dq.replace(/^c-?/i, "") : dq;
  const rows = useAsync(
    () => quotes.listQuotes({ ...(term && { q: term }), ...(status && { status }), limit }),
    [term, status, limit, lastSyncAt, pendingCount, conflicts],
  );
  const items = rows.data ?? [];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-surface px-4 pb-2 pt-1">
        <SearchBox label="Buscar cotización" placeholder="Folio o cliente" value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} />
        <div className="flex gap-2">
          <select aria-label="Filtrar por estado" className={`${INPUT} min-w-0 flex-1`} value={status} onChange={(e) => { setStatus(e.target.value as QuoteStatus | ""); setLimit(PAGE); }}>
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => <option key={s} value={s}>{QUOTE_STATUS_LABEL[s]}</option>)}
          </select>
          <Button className="shrink-0" disabled={!canCapture} onClick={onNew}>Nueva cotización</Button>
        </div>
        {!canCapture && <p className="text-xs text-warn">Para crear cotizaciones sincroniza primero: llevas demasiados días sin conexión.</p>}
      </div>
      {rows.error && <Alert>{rows.error} <button type="button" className="underline" onClick={rows.reload}>Reintentar</button></Alert>}
      {rows.loading && !rows.data ? (
        <Loading />
      ) : items.length === 0 ? (
        <Empty title={dq || status ? "Sin resultados" : "Sin cotizaciones"}>
          {dq || status ? "No hay cotizaciones que coincidan con la búsqueda." : "Crea una con «Nueva cotización»; se guarda en el teléfono aunque no tengas señal."}
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {items.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => onOpen(r.id)} className="block min-h-11 w-full px-4 py-3 text-left hover:bg-panel-2">
                <span className="flex items-baseline justify-between gap-3">
                  <FolioLabel q={r} className="min-w-0 text-sm font-medium text-accent-fg" />
                  <span className="shrink-0 text-sm font-medium tabular-nums text-ink">{amount(r.total, r.currency, r.exchangeRate)}</span>
                </span>
                <span className="mt-0.5 block truncate text-sm text-ink">{r.customerName || "—"}</span>
                <span className="block text-xs text-muted">{quoteStatus(r.status)}{r.updatedAt ? ` · ${fmtDate(r.updatedAt)}` : ""}</span>
                {r._sync && r._sync.state !== "applied" && <span className="mt-1 inline-block"><SyncBadge q={r} /></span>}
                {r._sync?.state === "rejected" && r._sync.error && <span className="mt-1 block text-xs text-danger">{r._sync.error}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {items.length >= limit && <Button variant="secondary" className="w-full" busy={rows.loading} onClick={() => setLimit((l) => l + PAGE)}>Mostrar {PAGE} más</Button>}
    </div>
  );
}

// ---------- Incidencias (Más) ----------

export function IssuesCard({ onOpen }: { onOpen: (id: string) => void }) {
  const { conflicts, pendingCount } = useApp();
  return (
    <Card title="Pendientes / incidencias">
      <p className="text-sm text-muted">{pendingCount === 0 ? "No hay cambios por enviar." : `${pendingCount} ${pendingCount === 1 ? "cambio" : "cambios"} por enviar al sincronizar.`}</p>
      {conflicts.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Sin incidencias.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {conflicts.map((q) => (
            <li key={q.id}>
              <button type="button" onClick={() => onOpen(q.id)} className="block min-h-11 w-full py-2 text-left">
                <span className="flex items-center justify-between gap-2">
                  <FolioLabel q={q} className="min-w-0 text-sm font-medium text-accent-fg" />
                  <SyncBadge q={q} />
                </span>
                <span className="block truncate text-sm text-ink">{q.customerName}</span>
                {q._sync?.error && <span className="block text-xs text-danger">{q._sync.error}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- Detalle ----------

const STATUS_ACTION: Partial<Record<QuoteStatus, string>> = {
  SENT: "Marcar como enviada",
  ACCEPTED: "Marcar como aceptada",
  REJECTED: "Marcar como rechazada",
  EXPIRED: "Marcar como vencida",
  CANCELLED: "Cancelar cotización",
};
const splitMails = (s: string) => s.split(/[,;\s]+/).map((x) => x.trim()).filter(Boolean);

function SyncBlock({ q }: { q: LocalQuote }) {
  const s = q._sync;
  if (!s || s.state === "applied") return null;
  if (s.state === "pending") return <Alert tone="warn">Pendiente de sincronizar. Los cambios están guardados en el teléfono y se enviarán al conectar.</Alert>;
  if (s.state === "rejected") {
    return (
      <Alert>
        <p className="font-medium">Rechazada por el servidor</p>
        <p>{s.error ?? "Sin motivo."}</p>
        {q.status === "DRAFT" && <p className="mt-1">Corrígela con «Editar» y guarda para reenviarla.</p>}
      </Alert>
    );
  }
  const c = s.conflict as PriceConflict | undefined;
  const rows = c && c.kind === "price" && Array.isArray(c.items) ? c.items : [];
  return (
    <Alert tone="info">
      <p className="font-medium">En revisión: los precios cambiaron desde que la capturaste. Gerencia lo revisará.</p>
      {rows.length > 0 && (
        <table className="mt-2 w-full table-fixed text-xs">
          <thead><tr className="text-left"><th className="w-[40%] py-1 font-medium">SKU</th><th className="py-1 text-right font-medium">Precio capturado</th><th className="py-1 text-right font-medium">Precio actual</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.productId} className="border-t border-current/20">
                <td className="break-all py-1 font-mono">{r.sku}</td>
                <td className="py-1 text-right tabular-nums">{money(r.clientPrice)}</td>
                <td className="py-1 text-right tabular-nums">{money(r.serverPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Alert>
  );
}

export function QuoteDetail({ id, notice, onEdit }: { id: string; notice?: string; onEdit: (id: string) => void }) {
  const app = useApp();
  const r = useAsync(async () => {
    const q = await app.quotes.getQuote(id);
    const c = q ? await app.controller.store.get("Customer", q.customerId) : null;
    return { q, c };
  }, [id, app.lastSyncAt, app.pendingCount, app.conflicts]);
  const [pdf, setPdf] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  const [mailOpen, setMailOpen] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [ask, setAsk] = useState<QuoteStatus | null>(null);
  const [busyStatus, setBusyStatus] = useState(false);

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <Alert>{r.error}</Alert>;
  const q = r.data?.q;
  if (!q) return <Empty title="Cotización no encontrada">Puede que se haya eliminado o reasignado.</Empty>;
  const customerEmail = str(r.data?.c?.email) ?? "";
  const own = q.sellerId === app.user?.id;
  const next = own ? QUOTE_TRANSITIONS[q.status].filter((s) => s !== "CONVERTED" && s !== "DRAFT") : [];
  const cur = (v: unknown) => amount(v, q.currency, q.exchangeRate);

  async function openPdf() {
    setPdf({ busy: true, error: null });
    try {
      if (Capacitor.isNativePlatform()) await app.shareQuotePdf(id);
      else {
        const bytes = await app.quotePdf(id);
        const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
        window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      setPdf({ busy: false, error: null });
    } catch (e) {
      setPdf({ busy: false, error: `No se pudo generar el PDF: ${errMsg(e)}` });
    }
  }

  async function change(to: QuoteStatus) {
    setAsk(null);
    setBusyStatus(true);
    setMsg(null);
    try {
      await app.quotes.changeStatus(id, to);
      setMsg({ tone: "ok", text: `Estado cambiado a «${quoteStatus(to)}». Se enviará al sincronizar.` });
    } catch (e) {
      setMsg({ tone: "danger", text: errMsg(e) });
    } finally {
      setBusyStatus(false);
    }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-ink"><FolioLabel q={q} /></h1>
        <p className="mt-0.5 text-ink">{q.customerName}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          <Badge tone="neutral">{quoteStatus(q.status)}</Badge>
          <SyncBadge q={q} />
        </div>
      </div>
      {notice && <Alert tone="ok">{notice}</Alert>}
      <SyncBlock q={q} />
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card title="Resumen">
        <Facts rows={[
          ["Vigencia", q.validUntil ? fmtDate(q.validUntil) : null],
          ["Moneda", q.currency],
          ["Tipo de cambio", q.currency === "USD" && q.exchangeRate ? dec(q.exchangeRate).toFixed(4) : null],
          ["Tiempo de entrega", q.deliveryTime],
          ["Garantía", q.warrantyMonths !== null ? warrantyText(q.warrantyMonths) : null],
          ["Vendedor", q.sellerName],
          ["Notas", q.notes],
        ]} />
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <Row k="Subtotal" v={cur(q.subtotal)} />
          <Row k="Descuento" v={`− ${cur(q.discountTotal)}`} />
          <Row k="IVA" v={cur(q.taxTotal)} />
          <Row k="Total" v={cur(q.total)} strong />
        </dl>
      </Card>

      <Card title={`Partidas (${q.items.length})`}>
        {q.items.length === 0 ? <p className="text-sm text-muted">Sin partidas.</p> : (
          <ul className="divide-y divide-line text-sm">
            {q.items.map((i) => (
              <li key={i.id} className="py-2">
                <p className="font-mono text-xs text-accent-fg">{i.sku}</p>
                <p className="text-ink">{i.description}</p>
                {i.details && <p className="whitespace-pre-line text-muted">{i.details}</p>}
                <p className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-muted">{qty(i.quantity)} {i.unit} × {cur(i.unitPrice)}{dec(i.discountPct).gt(0) ? ` · −${dec(i.discountPct).mul(100).toDecimalPlaces(2).toString()}%` : ""}</span>
                  <span className="shrink-0 font-medium tabular-nums text-ink">{cur(i.total)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {q.complements && q.complements.length > 0 && (
        <Card title="Complementos">
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink">{q.complements.map((c) => <li key={c.code}>{c.name}</li>)}</ul>
        </Card>
      )}

      <div className="space-y-2">
        {pdf.error && <Alert>{pdf.error}</Alert>}
        <Button variant="secondary" className="w-full" busy={pdf.busy} onClick={() => void openPdf()}>Ver PDF / Compartir</Button>
        {isProvisional(q) && <p className="text-xs text-muted">El PDF muestra un folio provisional; el definitivo llega al sincronizar.</p>}
        <Button variant="secondary" className="w-full" disabled={!app.canCapture} onClick={() => setMailOpen((o) => !o)} aria-expanded={mailOpen}>Enviar por correo</Button>
        {mailOpen && (
          <MailForm
            initialTo={customerEmail}
            onCancel={() => setMailOpen(false)}
            onSend={async (m) => { await app.quotes.emailQuote(id, m); setMailOpen(false); setMsg({ tone: "ok", text: "Correo en cola. Se enviará al conectar." }); }}
          />
        )}
        {own && q.status === "DRAFT" && <Button className="w-full" disabled={!app.canCapture} onClick={() => onEdit(id)}>Editar</Button>}
      </div>

      {next.length > 0 && (
        <Card title="Cambiar estado">
          <div className="space-y-2">
            {next.map((s) => (
              <Button key={s} variant={s === "CANCELLED" || s === "REJECTED" ? "danger" : "secondary"} className="w-full" busy={busyStatus} disabled={!app.canCapture}
                onClick={() => (s === "CANCELLED" || s === "REJECTED" ? setAsk(s) : void change(s))}>
                {STATUS_ACTION[s] ?? quoteStatus(s)}
              </Button>
            ))}
          </div>
        </Card>
      )}
      {!app.canCapture && <Alert tone="warn">Solo consulta: sincroniza para editar, enviar o cambiar el estado.</Alert>}

      <Confirm
        open={ask !== null}
        title={ask === "CANCELLED" ? "¿Cancelar la cotización?" : "¿Marcar como rechazada?"}
        body={<>La cotización {quoteFolioLabel(q)} pasará a «{ask ? quoteStatus(ask) : ""}». Este cambio no se puede deshacer.</>}
        confirmLabel={ask === "CANCELLED" ? "Cancelar cotización" : "Rechazar"}
        onCancel={() => setAsk(null)}
        onConfirm={() => ask && void change(ask)}
      />
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "text-base font-semibold text-ink" : "text-ink-soft"}`}>
      <dt>{k}</dt><dd className="tabular-nums">{v}</dd>
    </div>
  );
}

function MailForm({ initialTo, onSend, onCancel }: { initialTo: string; onSend: (m: { to: string[]; cc: string[]; message: string }) => Promise<void>; onCancel: () => void }) {
  const [to, setTo] = useState(initialTo);
  const [cc, setCc] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit() {
    setBusy(true);
    setErr(null);
    try { await onSend({ to: splitMails(to), cc: splitMails(cc), message }); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  }
  return (
    <form className="space-y-3 rounded-lg border border-line bg-panel p-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <Field label="Para" name="mail-to" type="text" inputMode="email" autoComplete="email" value={to} onChange={(e) => setTo(e.target.value)} hint="Separa varios correos con coma." />
      <Field label="CC" name="mail-cc" type="text" inputMode="email" value={cc} onChange={(e) => setCc(e.target.value)} />
      <label className="block" htmlFor="mail-msg">
        <span className="mb-1 block text-sm font-medium text-ink-soft">Mensaje</span>
        <textarea id="mail-msg" rows={3} className={`${INPUT} py-2`} value={message} onChange={(e) => setMessage(e.target.value)} />
      </label>
      {err && <Alert>{err}</Alert>}
      <p className="text-xs text-muted">Se enviará al conectar, con el PDF definitivo.</p>
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" busy={busy}>Enviar</Button>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

// ---------- Editor ----------

type Line = { key: string; productId: string; sku: string; description: string; kind: string; quantity: string; discountPct: string; unitPrice: string; details: string };
type Cust = { id: string; name: string };

const QTY_RE = /^\d+(\.\d{1,3})?$/;
const PCT_RE = /^\d+(\.\d{1,2})?$/;
const PRICE_RE = /^\d+(\.\d{1,2})?$/;
const today = () => new Date().toISOString().slice(0, 10);
let seq = 0;
const lineKey = () => `l${++seq}`;

function toOption(p: EntityRow): ComplementOption {
  return {
    code: String(p.code ?? ""), name: String(p.name ?? ""),
    activities: Array.isArray(p.activities) ? (p.activities as string[]) : [],
    warrantyMonths: Number(p.warrantyMonths ?? 3),
    skuPatterns: Array.isArray(p.skuPatterns) ? (p.skuPatterns as string[]) : [],
  };
}

export function QuoteEditor({ quoteId, customerId, onSaved, onCancel }: { quoteId?: string; customerId?: string; onSaved: (id: string) => void; onCancel: () => void }) {
  const { quotes, controller } = useApp();
  const init = useAsync(async () => {
    const store = controller.store;
    const [cfg, pk] = await Promise.all([quotes.config(), store.list<"ComplementPackage", EntityRow>("ComplementPackage", { orderBy: "position" })]);
    const options = pk.filter((p) => p.active !== false).map(toOption);
    const q = quoteId ? await quotes.getQuote(quoteId) : null;
    if (quoteId && !q) throw new Error("Cotización no encontrada.");
    const input = q ? quoteToInput(q) : null;
    const custId = input?.customerId ?? customerId;
    const customer = custId ? await store.get("Customer", custId) : null;
    const products = input ? await Promise.all(input.items.map((i) => store.get("Product", i.productId))) : [];
    return { cfg, options, q, input, customer, products };
  }, [quoteId, customerId]);

  if (init.loading && !init.data) return <Loading />;
  if (init.error) return <Alert>{init.error}</Alert>;
  const d = init.data!;
  if (d.q && d.q.status !== "DRAFT") return <Alert tone="warn">Solo se pueden editar cotizaciones en borrador.</Alert>;
  return <EditorForm {...d} quoteId={quoteId} onSaved={onSaved} onCancel={onCancel} />;
}

function EditorForm({ cfg, options, q, input, customer, products, quoteId, onSaved, onCancel }: {
  cfg: SyncConfig | null; options: ComplementOption[]; q: LocalQuote | null; input: QuoteInput | null; customer: EntityRow | null;
  products: (EntityRow | null)[]; quoteId?: string; onSaved: (id: string) => void; onCancel: () => void;
}) {
  const { quotes, canCapture } = useApp();
  const canOverride = cfg?.canOverridePrice ?? false;
  const maxPct = canOverride ? 100 : MAX_DISCOUNT_WITHOUT_OVERRIDE * 100;

  const [cust, setCust] = useState<Cust | null>(customer ? { id: customer.id, name: String(customer.legalName ?? "") } : null);
  const [validUntil, setValidUntil] = useState(input?.validUntil.slice(0, 10) ?? new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10));
  const [currency, setCurrency] = useState<"MXN" | "USD">(input?.currency ?? "MXN");
  const [deliveryTime, setDelivery] = useState(input?.deliveryTime ?? "");
  const [notes, setNotes] = useState(input?.notes ?? "");
  const [complements, setComplementsRaw] = useState<QuoteComplementInput[]>(input?.complements ?? []);
  const [warrantyTouched, setWarrantyTouched] = useState(input?.warrantyMonths !== undefined);
  const suggestedWarranty = (cs: QuoteComplementInput[]) => {
    const ms = cs.map((c) => options.find((o) => o.code === c.code)?.warrantyMonths).filter((m): m is number => m !== undefined);
    return ms.length ? String(Math.max(...ms)) : "";
  };
  const [warranty, setWarranty] = useState(input?.warrantyMonths !== undefined ? String(input.warrantyMonths) : suggestedWarranty(complements));
  const [lines, setLines] = useState<Line[]>(() => (input?.items ?? []).map((i, idx) => {
    const p = products[idx];
    const snap = q?.items.find((x) => x.productId === i.productId);
    return {
      key: lineKey(), productId: i.productId,
      sku: String(p?.sku ?? snap?.sku ?? ""), description: String(p?.description ?? snap?.description ?? ""), kind: String(p?.kind ?? snap?.kind ?? "PRODUCT"),
      quantity: i.quantity, discountPct: i.discountPct ?? "0", unitPrice: i.unitPrice ?? "", details: i.details ?? "",
    };
  }));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setComplements = (next: QuoteComplementInput[]) => {
    setComplementsRaw(next);
    if (!warrantyTouched) setWarranty(suggestedWarranty(next));
  };
  const upd = (key: string, p: Partial<Line>) => setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  function addProduct(p: EntityRow) {
    setLines((xs) => [...xs, {
      key: lineKey(), productId: p.id, sku: String(p.sku ?? ""), description: String(p.description ?? ""), kind: String(p.kind ?? "PRODUCT"),
      quantity: "1", discountPct: "0", unitPrice: "", details: "",
    }]);
    const add = suggestFor(options, String(p.sku ?? ""), String(p.description ?? "")).filter((o) => !complements.some((c) => c.code === o.code));
    if (add.length) setComplements([...complements, ...add.map(({ code, name, activities }) => ({ code, name, activities: [...activities] }))]);
  }

  // Validación local (el servidor vuelve a validar).
  const lineErr = (l: Line) => {
    const e: { qty?: string; pct?: string; price?: string } = {};
    if (!QTY_RE.test(l.quantity.trim()) || dec(l.quantity.trim()).lte(0)) e.qty = "Cantidad mayor a 0, hasta 3 decimales.";
    const pct = l.discountPct.trim() || "0";
    if (!PCT_RE.test(pct) || Number(pct) > maxPct) e.pct = `De 0 a ${maxPct}%.`;
    if (canOverride && l.unitPrice.trim() && !PRICE_RE.test(l.unitPrice.trim())) e.price = "Precio inválido (2 decimales).";
    return e;
  };
  const errs = lines.map(lineErr);
  const warrantyErr = warranty !== "" && (!/^\d+$/.test(warranty) || Number(warranty) > 60) ? "De 0 a 60 meses." : null;
  const dateErr = !/^\d{4}-\d{2}-\d{2}$/.test(validUntil) ? "Indica la vigencia." : validUntil < today() ? "La vigencia ya pasó." : null;
  const formErr = !cust ? "Elige un cliente." : lines.length === 0 ? "Agrega al menos una partida." : null;
  const linesOk = errs.every((e) => !e.qty && !e.pct && !e.price);
  const valid = !formErr && linesOk && !warrantyErr && !dateErr;

  const built: QuoteInput = {
    customerId: cust?.id ?? "",
    validUntil,
    currency,
    ...(notes.trim() && { notes: notes.trim() }),
    ...(deliveryTime.trim() && { deliveryTime: deliveryTime.trim() }),
    ...(warranty !== "" && !warrantyErr && { warrantyMonths: Number(warranty) }),
    complements,
    items: lines.map((l) => ({
      productId: l.productId,
      quantity: l.quantity.trim(),
      discountPct: l.discountPct.trim() || "0",
      ...(canOverride && l.unitPrice.trim() && { unitPrice: l.unitPrice.trim() }),
      ...(l.details.trim() && { details: l.details.trim() }),
    })),
  };
  const key = useDebounced(JSON.stringify({ items: built.items, currency, ok: linesOk }), 350);
  const pv = useAsync(async () => {
    const k = JSON.parse(key) as { items: QuoteInput["items"]; currency: "MXN" | "USD"; ok: boolean };
    if (!k.ok || k.items.length === 0) return null;
    return quotes.buildQuote({ customerId: "", validUntil: today(), currency: k.currency, items: k.items });
  }, [key]);
  const fx = pv.data?.exchangeRate ?? null;
  const cur = (v: unknown) => amount(v, currency, fx);

  async function save() {
    setTouched(true);
    setErr(null);
    if (!valid || !cust) return;
    setBusy(true);
    try {
      const row = quoteId ? await quotes.updateQuote(quoteId, built) : await quotes.createQuote(built);
      onSaved(row.id);
    } catch (e) {
      setErr(errMsg(e));
      setBusy(false);
    }
  }

  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
      <h1 className="text-lg font-semibold text-ink">{q ? <>Editar <FolioLabel q={q} /></> : "Nueva cotización"}</h1>
      {!canCapture && <Alert tone="warn">Llevas demasiados días sin sincronizar. Conéctate para volver a cotizar.</Alert>}

      <Card title="Cliente">
        <CustomerPicker value={cust} onChange={setCust} />
        {touched && !cust && <p className="mt-1 text-sm text-danger">Elige un cliente.</p>}
      </Card>

      <Card title="Condiciones">
        <div className="space-y-3">
          <Field label="Vigencia" name="validUntil" type="date" value={validUntil} min={today()} onChange={(e) => setValidUntil(e.target.value)} error={touched ? dateErr : null} />
          <fieldset>
            <legend className="mb-1 block text-sm font-medium text-ink-soft">Moneda</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["MXN", "USD"] as const).map((c) => (
                <Button key={c} variant={currency === c ? "primary" : "secondary"} aria-pressed={currency === c} onClick={() => setCurrency(c)}>{c}</Button>
              ))}
            </div>
          </fieldset>
          <Field label="Tiempo de entrega" name="deliveryTime" maxLength={200} placeholder="Ej. 5 días hábiles" value={deliveryTime} onChange={(e) => setDelivery(e.target.value)} />
          <Field label="Garantía (meses)" name="warrantyMonths" type="number" inputMode="numeric" min={0} max={60} placeholder="3" value={warranty}
            onChange={(e) => { setWarrantyTouched(true); setWarranty(e.target.value); }}
            hint={warranty && !warrantyErr ? `Cláusula D: ${warrantyText(Number(warranty))}` : "Vacío = 3 meses"} error={warrantyErr} />
          <label className="block" htmlFor="notes">
            <span className="mb-1 block text-sm font-medium text-ink-soft">Notas</span>
            <textarea id="notes" rows={3} className={`${INPUT} py-2`} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </Card>

      <Card title={`Partidas (${lines.length})`}>
        <div className="space-y-3">
          {lines.length === 0 && <p className="text-sm text-muted">Sin partidas. Busca un producto para agregarlo.</p>}
          {lines.map((l, idx) => {
            const e = errs[idx]!;
            const snap = pv.data?.items[idx];
            const list = pv.data?.listPrices[idx];
            return (
              <div key={l.key} className="rounded-md border border-line p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-all font-mono text-xs text-accent-fg">{l.sku}</p>
                    <p className="line-clamp-2 text-sm text-ink">{l.description}</p>
                  </div>
                  <Button variant="ghost" className="shrink-0 px-3 text-sm" aria-label={`Quitar partida ${idx + 1}`} onClick={() => setLines((xs) => xs.filter((x) => x.key !== l.key))}>Quitar</Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <Field label="Cantidad" name={`${l.key}-qty`} inputMode="decimal" value={l.quantity} onChange={(ev) => upd(l.key, { quantity: ev.target.value })} error={e.qty} />
                  <Field label="Descuento %" name={`${l.key}-pct`} inputMode="decimal" value={l.discountPct} onChange={(ev) => upd(l.key, { discountPct: ev.target.value })} error={e.pct} />
                </div>
                {canOverride && (
                  <div className="mt-2">
                    <Field label="Precio unitario manual (MXN)" name={`${l.key}-price`} inputMode="decimal" placeholder={list ? list.toFixed(2) : "Precio de lista"} value={l.unitPrice}
                      onChange={(ev) => upd(l.key, { unitPrice: ev.target.value })} error={e.price} hint="Vacío = precio de lista." />
                  </div>
                )}
                {l.kind === "SERVICE" && (
                  <label className="mt-2 block" htmlFor={`${l.key}-det`}>
                    <span className="mb-1 block text-sm font-medium text-ink-soft">Detalles / alcance del servicio</span>
                    <textarea id={`${l.key}-det`} rows={3} className={`${INPUT} py-2`} value={l.details} onChange={(ev) => upd(l.key, { details: ev.target.value })} />
                  </label>
                )}
                {snap && (
                  <p className="mt-2 flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-muted">{cur(snap.unitPrice)} c/u</span>
                    <span className="font-medium tabular-nums text-ink">{cur(snap.total)}</span>
                  </p>
                )}
              </div>
            );
          })}
          <ProductPicker onPick={addProduct} />
          {touched && lines.length === 0 && <p className="text-sm text-danger">Agrega al menos una partida.</p>}
        </div>
      </Card>

      {options.length > 0 && (
        <Card title="Complementos">
          <ul className="space-y-1">
            {options.map((o) => {
              const on = complements.some((c) => c.code === o.code);
              return (
                <li key={o.code}>
                  <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
                    <input type="checkbox" className="size-5 shrink-0 accent-brand" checked={on}
                      onChange={() => setComplements(on ? complements.filter((c) => c.code !== o.code) : [...complements, { code: o.code, name: o.name, activities: [...o.activities] }])} />
                    <span className="min-w-0">{o.name}<span className="block text-xs text-muted">Garantía {warrantyText(o.warrantyMonths)}</span></span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card title="Totales">
        {pv.error ? <Alert>{pv.error}</Alert> : !pv.data ? (
          <p className="text-sm text-muted">{lines.length === 0 ? "Agrega partidas para calcular." : !linesOk ? "Corrige las partidas para calcular." : "Calculando…"}</p>
        ) : (
          <dl className={`space-y-1 text-sm ${pv.loading ? "opacity-60" : ""}`} aria-busy={pv.loading || undefined}>
            <Row k="Subtotal" v={cur(pv.data.totals.subtotal)} />
            <Row k="Descuento" v={`− ${cur(pv.data.totals.discountTotal)}`} />
            <Row k="IVA" v={cur(pv.data.totals.taxTotal)} />
            <Row k="Total" v={cur(pv.data.totals.total)} strong />
            {currency === "USD" && fx && <p className="pt-1 text-xs text-muted">Tipo de cambio {fx.toFixed(4)}</p>}
          </dl>
        )}
      </Card>

      {err && <Alert>{err}</Alert>}
      {touched && !valid && !err && <Alert tone="warn">{formErr ?? dateErr ?? warrantyErr ?? "Revisa las partidas marcadas."}</Alert>}
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" busy={busy} disabled={!canCapture}>Guardar</Button>
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

function CustomerPicker({ value, onChange }: { value: Cust | null; onChange: (c: Cust | null) => void }) {
  const { controller } = useApp();
  const [open, setOpen] = useState(!value);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const rows = useAsync(
    () => (!open ? Promise.resolve([] as EntityRow[]) : dq ? controller.store.search<EntityRow>("Customer", dq, 20) : controller.store.list<"Customer", EntityRow>("Customer", { orderBy: "legalName", limit: 20 })),
    [dq, open],
  );
  if (value && !open) {
    return (
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 font-medium text-ink">{value.name}</p>
        <Button variant="ghost" className="shrink-0 px-3 text-sm" onClick={() => setOpen(true)}>Cambiar</Button>
      </div>
    );
  }
  const items = (rows.data ?? []).filter((c) => c.active !== false);
  return (
    <div className="space-y-2">
      <SearchBox label="Buscar cliente" placeholder="Razón social, RFC o correo" value={q} onChange={setQ} />
      {rows.error && <Alert>{rows.error}</Alert>}
      {rows.loading && !rows.data ? <Loading /> : items.length === 0 ? (
        <p className="text-sm text-muted">{dq ? `No hay clientes que coincidan con «${dq}».` : "No hay clientes en el teléfono."}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {items.map((c) => (
            <li key={c.id}>
              <button type="button" className="block min-h-11 w-full px-3 py-2 text-left hover:bg-panel-2" onClick={() => { onChange({ id: c.id, name: String(c.legalName ?? "") }); setOpen(false); setQ(""); }}>
                <span className="block truncate text-sm font-medium text-ink">{str(c.legalName)}</span>
                {str(c.rfc) && <span className="block text-xs text-muted">{str(c.rfc)}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {value && <Button variant="secondary" className="w-full" onClick={() => setOpen(false)}>Conservar «{value.name}»</Button>}
    </div>
  );
}

function ProductPicker({ onPick }: { onPick: (p: EntityRow) => void }) {
  const { controller } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const rows = useAsync(() => (open && dq ? controller.store.search<EntityRow>("Product", dq, 20) : Promise.resolve([] as EntityRow[])), [dq, open]);
  if (!open) return <Button variant="secondary" className="w-full" onClick={() => setOpen(true)}>+ Agregar producto</Button>;
  const items = rows.data ?? [];
  return (
    <div className="space-y-2 rounded-md border border-line-strong p-3">
      <SearchBox label="Buscar producto" placeholder="SKU, número de parte o descripción" value={q} onChange={setQ} />
      {rows.error && <Alert>{rows.error}</Alert>}
      {!dq ? <p className="text-sm text-muted">Escribe para buscar en el catálogo.</p> : rows.loading && !rows.data ? <Loading /> : items.length === 0 ? (
        <p className="text-sm text-muted">No hay productos que coincidan con «{dq}».</p>
      ) : (
        <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
          {items.map((p) => {
            const inactive = p.status === "INACTIVE";
            return (
              <li key={p.id}>
                <button type="button" disabled={inactive} className="block min-h-11 w-full px-3 py-2 text-left hover:bg-panel-2 disabled:opacity-60"
                  onClick={() => { onPick(p); setQ(""); setOpen(false); }}>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-xs font-medium text-accent-fg">{str(p.sku)}</span>
                    <span className="shrink-0 text-xs tabular-nums text-ink">{money(p.price, str(p.currency) ?? "MXN")}</span>
                  </span>
                  <span className="line-clamp-2 text-sm text-ink-soft">{str(p.description)}</span>
                  {inactive && <Badge tone="warn">Inactivo</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="ghost" className="w-full" onClick={() => { setOpen(false); setQ(""); }}>Cerrar búsqueda</Button>
    </div>
  );
}
