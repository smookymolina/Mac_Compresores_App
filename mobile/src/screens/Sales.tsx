import { useState, type ReactNode } from "react";
import { fmtDate } from "@domain/format";
import { isPendingSale, saleBalance, saleFolioLabel, useApp, type EntityRow, type LocalSale, type PaymentMethod } from "../core";
import { Alert, Badge, Button, Card, Confirm, Empty, Facts, Field, INPUT, Loading, SearchBox, errMsg, useAsync, useDebounced } from "../ui/kit";
import { money, qty, saleStatus, str } from "../ui/format";
import { SyncNotice, SyncStateBadge } from "../ui/sync";

export const METHOD_LABEL: Record<PaymentMethod, string> = { TRANSFER: "Transferencia", CASH: "Efectivo", CARD: "Tarjeta", CHECK: "Cheque", OTHER: "Otro" };
const PENDING_PAYMENT_MSG = "La venta aún no está confirmada por el servidor. Sincroniza antes de registrar pagos.";
const today = () => new Date().toLocaleDateString("en-CA");

function StatusBadge({ s }: { s: LocalSale }) {
  if (isPendingSale(s)) return <SyncStateBadge sync={s._sync ?? { state: "pending", commandId: null, onServer: false }} />;
  return <Badge tone={s.status === "CANCELLED" ? "danger" : "neutral"}>{saleStatus(s.status)}</Badge>;
}

export function SaleList({ onOpen }: { onOpen: (id: string) => void }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const r = useAsync(() => app.sales.listSales({ q: dq }), [dq, app.lastSyncAt, app.pendingCount, app.issues]);
  const items = r.data ?? [];
  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 bg-surface px-4 pb-2 pt-1">
        <SearchBox label="Buscar venta" placeholder="Folio o cliente" value={q} onChange={setQ} />
      </div>
      {r.error && <Alert>{r.error}</Alert>}
      {r.loading && !r.data ? <Loading /> : items.length === 0 ? (
        <Empty title={dq ? "Sin resultados" : "Sin ventas"}>{dq ? `No hay ventas que coincidan con «${dq}».` : "Convierte una cotización aceptada para registrar una venta."}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {items.map((s) => {
            const b = saleBalance(s);
            return (
              <li key={s.id}>
                <button type="button" onClick={() => onOpen(s.id)} className="block min-h-11 w-full px-4 py-3 text-left hover:bg-panel-2">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate font-medium ${isPendingSale(s) ? "text-warn" : "text-accent-fg"}`}>{saleFolioLabel(s)}</span>
                    <StatusBadge s={s} />
                  </span>
                  <span className="block truncate text-sm text-ink">{s.customerName}</span>
                  <span className="flex justify-between gap-2 text-sm tabular-nums">
                    <span className="text-muted">Total {money(s.total)}</span>
                    <span className={b.balance.gt(0) ? "font-medium text-ink" : "text-ok"}>Saldo {money(b.balance.toFixed(2))}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
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

export function SaleDetail({ id, notice, onOpenQuote, onDismissed }: { id: string; notice?: string; onOpenQuote: (id: string) => void; onDismissed: () => void }) {
  const app = useApp();
  const r = useAsync(async () => {
    const s = await app.sales.getSale(id);
    const w = s ? await app.controller.store.get<EntityRow>("Warehouse", s.warehouseId) : null;
    return { s, w };
  }, [id, app.lastSyncAt, app.pendingCount, app.issues]);
  const [payOpen, setPayOpen] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "danger"; text: string } | null>(null);
  const [askDismiss, setAskDismiss] = useState(false);

  if (r.loading && !r.data) return <Loading />;
  if (r.error) return <Alert>{r.error}</Alert>;
  const s = r.data?.s;
  if (!s) return <Empty title="Venta no encontrada">Puede que ya se haya sincronizado con otro folio. Revisa la lista de ventas.</Empty>;
  const b = saleBalance(s);
  const pending = isPendingSale(s);
  const canPay = app.can("payments.write");

  async function dismiss(paymentId?: string) {
    setAskDismiss(false);
    try {
      await app.sales.dismissRejected(s!.id, paymentId);
      if (!paymentId) onDismissed(); else { setMsg({ tone: "ok", text: "Pago rechazado descartado." }); r.reload(); }
    } catch (e) { setMsg({ tone: "danger", text: errMsg(e) }); }
  }

  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-semibold text-ink">{saleFolioLabel(s)}</h1>
        <p className="mt-0.5 text-ink">{s.customerName}</p>
        <div className="mt-1 flex flex-wrap gap-2"><StatusBadge s={s} /></div>
      </div>
      {notice && <Alert tone="ok">{notice}</Alert>}
      <SyncNotice sync={s._sync} pendingText="Venta pendiente: se confirmará (y tomará folio) cuando el servidor la reciba al sincronizar." />
      {pending && s._sync?.state === "rejected" && <Button variant="danger" className="w-full" onClick={() => setAskDismiss(true)}>Descartar venta rechazada</Button>}
      {pending && s.stockWarnings && s.stockWarnings.length > 0 && s._sync?.state === "pending" && (
        <Alert tone="warn">
          <p className="font-medium">Existencia local insuficiente; gerencia decidirá al sincronizar:</p>
          <ul className="mt-1">{s.stockWarnings.map((w) => <li key={w.productId}><span className="font-mono">{w.sku}</span>: pides {qty(w.requested)}, hay {qty(w.available)}</li>)}</ul>
        </Alert>
      )}
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}

      <Card title="Resumen">
        <Facts rows={[
          ["Cotización", s.quoteFolio ? <button type="button" className="text-accent-fg underline" onClick={() => onOpenQuote(s.quoteId)}>{str(s.quoteLabel) ?? `Q-${s.quoteFolio}`}</button> : <button type="button" className="text-accent-fg underline" onClick={() => onOpenQuote(s.quoteId)}>Ver cotización</button>],
          ["Almacén", str(r.data?.w?.name) ?? str(r.data?.w?.code)],
          ["Confirmada", s.confirmedAt ? fmtDate(s.confirmedAt) : null],
        ]} />
        <dl className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          <Row k="Subtotal" v={money(s.subtotal)} />
          <Row k="Descuento" v={`− ${money(s.discountTotal)}`} />
          <Row k="IVA" v={money(s.taxTotal)} />
          <Row k="Total" v={money(s.total)} strong />
          <Row k="Pagado" v={money(b.paid.toFixed(2))} />
          {b.pendingPaid.gt(0) && <Row k="Pagos por enviar" v={money(b.pendingPaid.toFixed(2))} />}
          <Row k="Saldo" v={money(b.balance.toFixed(2))} strong />
        </dl>
      </Card>

      <Card title={`Partidas (${s.items.length})`}>
        {s.items.length === 0 ? <p className="text-sm text-muted">Sin partidas.</p> : (
          <ul className="divide-y divide-line text-sm">
            {s.items.map((i) => (
              <li key={i.id} className="py-2">
                <p className="font-mono text-xs text-accent-fg">{i.sku}</p>
                <p className="text-ink">{i.description}</p>
                <p className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-muted">{qty(i.quantity)} {i.unit} × {money(i.unitPrice)}</span>
                  <span className="shrink-0 font-medium tabular-nums text-ink">{money(i.total)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={`Pagos (${(s.payments ?? []).length})`}>
        {(s.payments ?? []).length === 0 ? <p className="text-sm text-muted">Sin pagos registrados.</p> : (
          <ul className="divide-y divide-line text-sm">
            {s.payments.map((p) => (
              <li key={p.id} className="py-2">
                <p className="flex items-baseline justify-between gap-3">
                  <span className="text-ink">{METHOD_LABEL[p.method] ?? p.method} · {fmtDate(p.paidAt)}</span>
                  <span className={`shrink-0 font-medium tabular-nums ${p.voidedAt ? "text-muted line-through" : "text-ink"}`}>{money(p.amount)}</span>
                </p>
                {p.reference && <p className="text-muted">Ref. {p.reference}</p>}
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {p.voidedAt && <Badge tone="danger">Cancelado</Badge>}
                  <SyncStateBadge sync={p._sync} />
                </div>
                {p._sync?.state === "rejected" && (
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-xs text-danger">{p._sync.error ?? "Rechazado por el servidor."}</span>
                    <Button variant="ghost" className="shrink-0 px-3 text-sm" onClick={() => void dismiss(p.id)}>Descartar</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canPay && s.status !== "CANCELLED" && (pending ? (
        <Alert tone="warn">{PENDING_PAYMENT_MSG}</Alert>
      ) : b.balance.gt(0) && (payOpen ? (
        <PaymentForm saleId={s.id} balance={b.balance.toFixed(2)} onCancel={() => setPayOpen(false)}
          onDone={() => { setPayOpen(false); setMsg({ tone: "ok", text: "Pago guardado en el teléfono; se enviará al sincronizar." }); r.reload(); }} />
      ) : (
        <Button className="w-full" disabled={!app.canCapture} onClick={() => { setPayOpen(true); setMsg(null); }}>Registrar pago</Button>
      )))}
      {canPay && !app.canCapture && <Alert tone="warn">Solo consulta: sincroniza para registrar pagos.</Alert>}

      <Confirm open={askDismiss} title="¿Descartar la venta rechazada?" body="Se quitará del teléfono. La cotización seguirá aceptada y podrás volver a convertirla." confirmLabel="Descartar"
        onCancel={() => setAskDismiss(false)} onConfirm={() => void dismiss()} />
    </div>
  );
}

function PaymentForm({ saleId, balance, onDone, onCancel }: { saleId: string; balance: string; onDone: () => void; onCancel: () => void }) {
  const app = useApp();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("TRANSFER");
  const [paidAt, setPaidAt] = useState(today);
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setErr(null);
    try { await app.sales.registerPayment(saleId, { amount: amount.replace(/[,\s$]/g, ""), method, paidAt, reference }); onDone(); }
    catch (e) { setErr(errMsg(e)); setBusy(false); }
  }

  return (
    <Card title="Registrar pago">
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <Field label="Monto (MXN)" name="pay-amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} hint={`Saldo: ${money(balance)}`} />
        <button type="button" className="-mt-2 min-h-11 text-sm font-medium text-accent-fg" onClick={() => setAmount(balance)}>Usar saldo completo</button>
        <label className="block" htmlFor="pay-method">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Método</span>
          <select id="pay-method" className={INPUT} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
            {(Object.keys(METHOD_LABEL) as PaymentMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
          </select>
        </label>
        <Field label="Fecha" name="pay-date" type="date" max={today()} value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        <Field label="Referencia" name="pay-ref" value={reference} onChange={(e) => setReference(e.target.value)} hint="Opcional: núm. de transferencia, cheque…" />
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" className="flex-1" busy={busy}>Guardar pago</Button>
        </div>
      </form>
    </Card>
  );
}

/** «Convertir en venta» en una cotización aceptada (requiere `sales.create`). */
export function ConvertToSale({ quoteId, accepted, onOpenSale }: { quoteId: string; accepted: boolean; onOpenSale: (id: string, notice?: string) => void }) {
  const app = useApp();
  const r = useAsync(async () => {
    const store = app.controller.store;
    const [quote, warehouses, sales] = await Promise.all([
      app.quotes.getQuote(quoteId),
      store.list<"Warehouse", EntityRow>("Warehouse", { orderBy: "code" }),
      store.list<"Sale", LocalSale>("Sale", { where: { quoteId } }),
    ]);
    return { quote, warehouses: warehouses.filter((w) => w.active !== false), sale: sales.find((s) => !(isPendingSale(s) && s._sync?.state === "rejected")) ?? null };
  }, [quoteId, app.lastSyncAt, app.pendingCount]);
  const [open, setOpen] = useState(false);
  const [wid, setWid] = useState("");
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const warn = useAsync(async () => (wid && r.data?.quote ? app.sales.previewStock(r.data.quote.items, wid) : []), [wid, r.data?.quote]);

  if (r.loading && !r.data) return null;
  if (r.error) return <Alert>{r.error}</Alert>;
  const d = r.data!;
  if (d.sale) return <Button variant="secondary" className="w-full" onClick={() => onOpenSale(d.sale!.id)}>Ver venta {saleFolioLabel(d.sale)}</Button>;
  if (!accepted) return null;
  if (!open) return <Button className="w-full" disabled={!app.canCapture} onClick={() => setOpen(true)}>Convertir en venta</Button>;
  const warnings = warn.data ?? [];

  async function convert() {
    setAsk(false); setBusy(true); setErr(null);
    try {
      const { sale, warnings: w } = await app.sales.convertQuote(quoteId, wid);
      onOpenSale(sale.id, `Venta pendiente guardada en el teléfono; se confirmará al sincronizar.${w.length ? " Hay avisos de existencia: gerencia decidirá." : ""}`);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  }

  return (
    <Card title="Convertir en venta">
      <div className="space-y-3">
        {d.warehouses.length === 0 ? <Alert tone="warn">No hay almacenes en el teléfono. Sincroniza e inténtalo de nuevo.</Alert> : (
          <label className="block" htmlFor="conv-wh">
            <span className="mb-1 block text-sm font-medium text-ink-soft">Almacén de salida</span>
            <select id="conv-wh" className={INPUT} value={wid} onChange={(e) => setWid(e.target.value)}>
              <option value="">Elige un almacén…</option>
              {d.warehouses.map((w) => <option key={w.id} value={w.id}>{[str(w.code), str(w.name)].filter(Boolean).join(" · ")}</option>)}
            </select>
          </label>
        )}
        {wid && warn.loading && <p className="text-sm text-muted">Revisando existencias…</p>}
        {wid && !warn.loading && (warnings.length > 0 ? (
          <Alert tone="warn">
            <p className="font-medium">Existencia local insuficiente (puedes continuar; gerencia decidirá):</p>
            <ul className="mt-1">{warnings.map((w) => <li key={w.productId}><span className="font-mono">{w.sku}</span>: pides {qty(w.requested)}, hay {qty(w.available)}</li>)}</ul>
          </Alert>
        ) : <Alert tone="ok">Hay existencia local suficiente.</Alert>)}
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={() => { setOpen(false); setWid(""); setErr(null); }}>Cancelar</Button>
          <Button className="flex-1" busy={busy} disabled={!wid || !app.canCapture} onClick={() => setAsk(true)}>Convertir</Button>
        </div>
      </div>
      <Confirm open={ask} tone="primary" title="¿Convertir en venta?" confirmLabel="Convertir"
        body={<>Se guardará una venta pendiente con las partidas de la cotización.{warnings.length > 0 && ` ${warnings.length} producto(s) sin existencia suficiente.`}</>}
        onCancel={() => setAsk(false)} onConfirm={() => void convert()} />
    </Card>
  );
}
