import { useState } from "react";
import { dec } from "@domain/money";
import { balanceId, movementDelta, useApp, type EntityRow, type LocalStockBalance, type MovementType } from "../core";
import { Alert, Badge, Button, Card, Empty, Field, INPUT, Loading, SearchBox, errMsg, useAsync, useDebounced } from "../ui/kit";
import { qty, str } from "../ui/format";
import { SyncStateBadge } from "../ui/sync";

const TYPE_LABEL: Record<MovementType, string> = { IN: "Entrada", OUT: "Salida", ADJUST: "Ajuste" };
type Selection = { productId: string; sku: string; description: string; warehouseId: string };

export function InventoryScreen() {
  const app = useApp();
  const store = app.controller.store;
  const [wid, setWid] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 200);
  const [form, setForm] = useState<Selection | "new" | null>(null);
  const [msg, setMsg] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const wh = useAsync(async () => (await store.list<"Warehouse", EntityRow>("Warehouse", { orderBy: "code" })).filter((w) => w.active !== false), [app.lastSyncAt]);
  const rows = useAsync(() => app.inventory.listBalances({ warehouseId: wid || undefined, q: dq }), [wid, dq, app.lastSyncAt, app.pendingCount]);
  const moves = useAsync(() => app.inventory.listMovements({ state: "pending" }), [app.lastSyncAt, app.pendingCount]);

  if (!app.can("inventory.read")) return <Empty title="Sin permiso">No tienes permiso para consultar el inventario.</Empty>;
  const warehouses = wh.data ?? [];
  const whName = (id: string) => { const w = warehouses.find((x) => x.id === id); return str(w?.code) ?? str(w?.name) ?? "—"; };
  const writable = app.can("inventory.write");
  const items = rows.data ?? [];

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10 -mx-4 space-y-2 bg-surface px-4 pb-2 pt-1">
        <SearchBox label="Buscar existencia" placeholder="SKU, núm. de parte o descripción" value={q} onChange={setQ} />
        <select aria-label="Almacén" className={INPUT} value={wid} onChange={(e) => setWid(e.target.value)}>
          <option value="">Todos los almacenes</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{[str(w.code), str(w.name)].filter(Boolean).join(" · ")}</option>)}
        </select>
      </div>
      {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      {writable && (form ? (
        <MovementForm key={form === "new" ? "new" : `${form.productId}:${form.warehouseId}`} pick={form === "new" ? null : form} defaultWarehouse={wid} warehouses={warehouses}
          onCancel={() => setForm(null)}
          onDone={(warning) => { setForm(null); setMsg(warning ? { tone: "warn", text: `Movimiento guardado. ${warning} El servidor decidirá al sincronizar.` } : { tone: "ok", text: "Movimiento guardado en el teléfono; se enviará al sincronizar." }); }} />
      ) : (
        <Button className="w-full" disabled={!app.canCapture} onClick={() => { setForm("new"); setMsg(null); }}>Registrar movimiento</Button>
      ))}
      {writable && !app.canCapture && <Alert tone="warn">Solo consulta: sincroniza para registrar movimientos.</Alert>}

      {(moves.data ?? []).length > 0 && (
        <Card title={`Movimientos por enviar (${moves.data!.length})`}>
          <ul className="divide-y divide-line text-sm">
            {moves.data!.map((m) => (
              <li key={m.id} className="py-2">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate"><span className="font-mono text-accent-fg">{m.sku}</span> · {whName(m.warehouseId)}</span>
                  <span className={`shrink-0 font-medium tabular-nums ${dec(m.delta).lt(0) ? "text-danger" : "text-ok"}`}>{dec(m.delta).gt(0) ? "+" : ""}{qty(m.delta)}</span>
                </p>
                <p className="flex items-center gap-2 text-muted"><span className="min-w-0 truncate">{TYPE_LABEL[m.type]} · {m.reason}</span><SyncStateBadge sync={m._sync} short /></p>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.error && <Alert>{rows.error}</Alert>}
      {rows.loading && !rows.data ? <Loading /> : items.length === 0 ? (
        <Empty title={dq ? "Sin resultados" : "Sin existencias"}>{dq ? `No hay existencias que coincidan con «${dq}».` : "No hay existencias registradas en este almacén."}</Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {items.map((b) => {
            const neg = dec(b.quantity).lt(0);
            const low = !neg && b.minStock && dec(b.quantity).lt(dec(b.minStock));
            const body = (
              <>
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-mono text-sm text-accent-fg">{b.sku}</span>
                  <span className={`shrink-0 font-semibold tabular-nums ${neg ? "text-danger" : "text-ink"}`}>{qty(b.quantity)} {b.unit}</span>
                </span>
                <span className="block truncate text-sm text-ink">{b.description}</span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {!wid && <span>{whName(b.warehouseId)}</span>}
                  {b._pending && <Badge tone="warn">Con movimientos por enviar</Badge>}
                  {neg && <Badge tone="danger">Negativa</Badge>}
                  {low && <Badge tone="warn">Bajo mínimo</Badge>}
                </span>
              </>
            );
            return (
              <li key={b.id}>
                {writable && app.canCapture ? (
                  <button type="button" aria-label={`Registrar movimiento de ${b.sku}`} className="block min-h-11 w-full px-4 py-3 text-left hover:bg-panel-2"
                    onClick={() => { setForm({ productId: b.productId, sku: b.sku, description: b.description, warehouseId: b.warehouseId }); setMsg(null); window.scrollTo(0, 0); }}>{body}</button>
                ) : <div className="px-4 py-3">{body}</div>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MovementForm({ pick, defaultWarehouse, warehouses, onDone, onCancel }: {
  pick: Selection | null; defaultWarehouse: string; warehouses: EntityRow[]; onDone: (warning: string | null) => void; onCancel: () => void;
}) {
  const app = useApp();
  const store = app.controller.store;
  const [product, setProduct] = useState<{ id: string; sku: string; description: string } | null>(pick ? { id: pick.productId, sku: pick.sku, description: pick.description } : null);
  const [wid, setWid] = useState(pick?.warehouseId ?? defaultWarehouse ?? "");
  const [type, setType] = useState<MovementType>("IN");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pq, setPq] = useState("");
  const dpq = useDebounced(pq.trim(), 200);
  const found = useAsync(async () => (dpq && !product ? store.search<EntityRow>("Product", dpq, 20) : []), [dpq, product]);
  const cur = useAsync(async () => (product && wid ? store.get<LocalStockBalance>("StockBalance", balanceId(product.id, wid)) : null), [product, wid]);

  const current = dec(cur.data?.quantity ?? 0);
  let projected: string | null = null;
  try { if (/^-?\d+(\.\d{1,3})?$/.test(quantity.trim())) projected = current.add(movementDelta(type, quantity.trim())).toString(); } catch { projected = null; }
  const negative = projected !== null && dec(projected).lt(0);

  async function submit() {
    if (!product) { setErr("Elige un producto."); return; }
    if (!wid) { setErr("Elige un almacén."); return; }
    setBusy(true); setErr(null);
    try {
      const r = await app.inventory.registerMovement({ productId: product.id, warehouseId: wid, type, quantity: quantity.trim(), reason });
      onDone(r.warning);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  }

  return (
    <Card title="Registrar movimiento">
      <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        {product ? (
          <div className="flex items-start justify-between gap-2 rounded-md border border-line bg-panel-2 p-3">
            <div className="min-w-0 text-sm">
              <p className="font-mono text-accent-fg">{product.sku}</p>
              <p className="text-ink">{product.description}</p>
            </div>
            {!pick && <Button variant="ghost" className="shrink-0 px-3 text-sm" onClick={() => { setProduct(null); setPq(""); }}>Cambiar</Button>}
          </div>
        ) : (
          <div className="space-y-2">
            <SearchBox label="Buscar producto" placeholder="Producto: SKU o descripción" value={pq} onChange={setPq} />
            {found.data && found.data.length > 0 && (
              <ul className="max-h-64 divide-y divide-line overflow-y-auto rounded-md border border-line">
                {found.data.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-panel-2"
                      onClick={() => setProduct({ id: p.id, sku: String(p.sku ?? ""), description: String(p.description ?? "") })}>
                      <span className="block font-mono text-accent-fg">{str(p.sku)}</span>
                      <span className="block truncate text-ink">{str(p.description)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {dpq && found.data?.length === 0 && !found.loading && <p className="text-sm text-muted">Sin productos que coincidan.</p>}
          </div>
        )}
        <label className="block" htmlFor="mv-wh">
          <span className="mb-1 block text-sm font-medium text-ink-soft">Almacén</span>
          <select id="mv-wh" className={INPUT} value={wid} disabled={!!pick} onChange={(e) => setWid(e.target.value)}>
            <option value="">Elige un almacén…</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{[str(w.code), str(w.name)].filter(Boolean).join(" · ")}</option>)}
          </select>
        </label>
        <fieldset>
          <legend className="mb-1 block text-sm font-medium text-ink-soft">Tipo</legend>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TYPE_LABEL) as MovementType[]).map((t) => (
              <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(t)}
                className={`min-h-11 rounded-md border text-sm font-medium ${type === t ? "border-brand bg-brand text-white" : "border-line-strong bg-panel text-ink"}`}>{TYPE_LABEL[t]}</button>
            ))}
          </div>
        </fieldset>
        <Field label="Cantidad" name="mv-qty" inputMode={type === "ADJUST" ? "text" : "decimal"} required value={quantity} onChange={(e) => setQuantity(e.target.value)}
          hint={type === "ADJUST" ? "Con signo: positivo suma, negativo resta (p. ej. -2)." : "Máximo 3 decimales."} />
        {product && wid && (
          <p className="text-sm text-muted">Existencia actual: <span className="font-medium tabular-nums text-ink">{qty(current.toString())}</span>
            {projected !== null && <> → queda <span className={`font-medium tabular-nums ${negative ? "text-danger" : "text-ink"}`}>{qty(projected)}</span></>}</p>
        )}
        {negative && <Alert tone="warn">La existencia quedaría negativa ({qty(projected)}). Puedes guardarlo; el servidor decidirá al sincronizar.</Alert>}
        <Field label="Motivo" name="mv-reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} hint="Ej.: recepción de proveedor, conteo físico, merma." />
        {err && <Alert>{err}</Alert>}
        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancelar</Button>
          <Button type="submit" className="flex-1" busy={busy}>Guardar</Button>
        </div>
      </form>
    </Card>
  );
}
