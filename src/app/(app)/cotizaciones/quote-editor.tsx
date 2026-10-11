"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui";
import { searchProductsAction } from "@/modules/products/actions";

export interface EditorItem {
  productId: string;
  sku: string;
  description: string;
  unit: string;
  listPrice: string;
  taxRate: string;
  quantity: string;
  discountPct: string; // 0-100
  unitPrice: string; // vacío = precio de lista
  details?: string; // actividades/alcance del servicio
  priceUsd?: string | null; // precio de lista original en USD (tubería)
}

type Found = Awaited<ReturnType<typeof searchProductsAction>>[number];

const MAX_DISCOUNT = 15;

// Vista previa en centavos; el servidor recalcula con decimales exactos y es la fuente de verdad.
function preview(items: EditorItem[]) {
  let sub = 0, disc = 0, tax = 0;
  for (const i of items) {
    const price = Number(i.unitPrice || i.listPrice) || 0;
    const s = Math.round((Number(i.quantity) || 0) * price * 100);
    const d = Math.round((s * (Number(i.discountPct) || 0)) / 100);
    sub += s; disc += d; tax += Math.round((s - d) * Number(i.taxRate));
  }
  const f = (c: number) => (c / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
  return { sub: f(sub), disc: f(disc), tax: f(tax), total: f(sub - disc + tax) };
}

function lineAmount(i: EditorItem) {
  const s = Math.round((Number(i.quantity) || 0) * (Number(i.unitPrice || i.listPrice) || 0) * 100);
  const net = s - Math.round((s * (Number(i.discountPct) || 0)) / 100);
  return (net / 100).toLocaleString("es-MX", { style: "currency", currency: "MXN" });
}

export function QuoteEditor({
  action, customers, initial, canOverride,
}: {
  action: (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  customers: { id: string; legalName: string }[];
  initial?: { customerId: string; validUntil: string; notes: string; deliveryTime?: string; items: EditorItem[] };
  canOverride: boolean;
}) {
  const [items, setItems] = useState<EditorItem[]>(initial?.items ?? []);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [searching, startSearch] = useTransition();
  const [, startSubmit] = useTransition();
  const [state, formAction, pending] = useActionState(action, null);
  const defaultValid = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);

  // Una consulta por pausa de tecleo (250 ms) y solo vale la respuesta de la última.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const latest = useRef("");
  const search = (t: string) => {
    setTerm(t);
    clearTimeout(timer.current);
    latest.current = t;
    if (t.trim().length < 2) return setFound([]);
    timer.current = setTimeout(() => startSearch(async () => {
      const res = await searchProductsAction(t);
      if (latest.current === t) setFound(res);
    }), 250);
  };
  const add = (p: Found) => {
    setItems((xs) => [...xs, {
      productId: p.id, sku: p.sku, description: p.description, unit: p.unit, listPrice: p.price,
      taxRate: p.taxRate, quantity: "1", discountPct: "0", unitPrice: "", details: "", priceUsd: p.priceUsd,
    }]);
    setTerm("");
    setFound([]);
  };
  const upd = (i: number, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const t = preview(items);
  const [globalDisc, setGlobalDisc] = useState("");
  const usd = (it: EditorItem) => (it.priceUsd ? ` (USD ${it.priceUsd})` : "");
  const detailsField = (it: EditorItem, i: number) => (
    <label className="block text-xs text-ink-soft">Actividades / alcance del trabajo (opcional)
      <textarea className="input mt-1" rows={2} maxLength={4000} value={it.details ?? ""} onChange={(e) => upd(i, { details: e.target.value })} placeholder="Ej. Cambio de filtros, revisión de bandas, prueba de presión…" />
    </label>
  );

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault(); // evita el reseteo automático del formulario en React 19
        const fd = new FormData(e.currentTarget);
        startSubmit(() => formAction(fd));
      }}
    >
      <input type="hidden" name="items" value={JSON.stringify(items.map(({ productId, quantity, discountPct, unitPrice, details }) => ({ productId, quantity, discountPct, unitPrice, details })))} />
      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <label className="label" htmlFor="customerId">Cliente</label>
          <select id="customerId" name="customerId" className="input" defaultValue={initial?.customerId} required>
            <option value="">Selecciona…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.legalName}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="validUntil">Vigencia</label>
          <input id="validUntil" name="validUntil" type="date" className="input" defaultValue={initial?.validUntil || defaultValid} required />
        </div>
        <div>
          <label className="label" htmlFor="deliveryTime">Tiempo de entrega</label>
          <input id="deliveryTime" name="deliveryTime" className="input" maxLength={200} list="delivery-options" defaultValue={initial?.deliveryTime} placeholder="Ej. 5 días hábiles" />
          <datalist id="delivery-options">
            <option value="Inmediata, sujeto a existencia" />
            <option value="Por confirmar según disponibilidad" />
            <option value="Programado de común acuerdo con el cliente" />
          </datalist>
        </div>
      </div>

      <div className="relative">
        <label className="label" htmlFor="search">Agregar producto o servicio</label>
        <input id="search" className="input" value={term} onChange={(e) => search(e.target.value)} placeholder="SKU, descripción o no. de parte" autoComplete="off" enterKeyHint="search" aria-describedby="search-hint" />
        <p id="search-hint" className="mt-1 text-xs text-ink-soft">Escribe al menos 2 caracteres.</p>
        {(found.length > 0 || searching) && (
          <ul className="absolute z-20 mt-1 max-h-[min(18rem,50dvh)] w-full overflow-auto overscroll-contain rounded-md border border-line bg-panel shadow-lg">
            {searching && <li className="px-3 py-2 text-sm text-ink-soft">Buscando…</li>}
            {found.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => add(p)} className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface focus-visible:bg-surface">
                  <span className="min-w-0 break-words"><b>{p.sku}</b> — {p.description}</span>
                  <span className="shrink-0 text-right tabular-nums">{Number(p.price) > 0 ? `$${p.price}` : p.priceUsd ? "falta TC" : "sin precio"}{p.priceUsd && <span className="block text-xs text-ink-soft">USD {p.priceUsd}</span>}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {items.length > 1 && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-soft">Descuento general %
            <input className="input num mt-1 w-28" inputMode="decimal" value={globalDisc} max={canOverride ? 99 : MAX_DISCOUNT} onChange={(e) => setGlobalDisc(e.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary" disabled={globalDisc === ""} onClick={() => setItems((xs) => xs.map((x) => ({ ...x, discountPct: globalDisc })))}>Aplicar a todas las partidas</button>
        </div>
      )}

      {/* Móvil: partidas como tarjetas (la tabla de abajo es solo para md+) */}
      <ul className="divide-y divide-line rounded-md border border-line md:hidden">
        {items.length === 0 && <li className="py-6 text-center text-sm text-ink-soft">Sin partidas.</li>}
        {items.map((it, i) => (
          <li key={i} className="space-y-2 p-3">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <b className="break-words">{i + 1}. {it.sku}</b>
                <div className="break-words text-xs text-ink-soft">{it.description}</div>
                <div className="text-xs tabular-nums text-ink-soft">Lista ${it.listPrice}{usd(it)}{it.unit && ` / ${it.unit}`}</div>
              </div>
              <button type="button" aria-label={`Quitar ${it.sku}`} className="btn btn-ghost icon-btn shrink-0 text-danger" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
            </div>
            <div className={canOverride ? "grid grid-cols-3 gap-2" : "grid grid-cols-2 gap-2"}>
              <label className="text-xs text-ink-soft">Cant.<input className="input num mt-1" inputMode="decimal" value={it.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></label>
              {canOverride && <label className="text-xs text-ink-soft">P. especial<input className="input num mt-1" inputMode="decimal" placeholder="—" value={it.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} /></label>}
              <label className="text-xs text-ink-soft">Desc. %<input className="input num mt-1" inputMode="decimal" value={it.discountPct} max={canOverride ? 99 : MAX_DISCOUNT} onChange={(e) => upd(i, { discountPct: e.target.value })} /></label>
            </div>
            {detailsField(it, i)}
            <div className="flex justify-between text-sm"><span className="text-ink-soft">Importe</span><span className="num font-medium">{lineAmount(it)}</span></div>
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto rounded-md border border-line md:block">
        <table className="table">
          <thead>
            <tr><th>#</th><th>Concepto</th><th className="num">Cant.</th><th className="num">Precio lista</th>{canOverride && <th className="num">Precio especial</th>}<th className="num">Desc. %</th><th /></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-ink-soft">Sin partidas.</td></tr>}
            {items.map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td className="min-w-64"><b>{it.sku}</b><div className="text-xs text-ink-soft">{it.description}</div><div className="mt-1">{detailsField(it, i)}</div></td>
                <td className="w-24"><input aria-label="Cantidad" className="input num" inputMode="decimal" value={it.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></td>
                <td className="num">${it.listPrice}{it.priceUsd && <div className="text-xs text-ink-soft">USD {it.priceUsd}</div>}</td>
                {canOverride && <td className="w-32"><input aria-label="Precio especial" className="input num" inputMode="decimal" placeholder="—" value={it.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} /></td>}
                <td className="w-24"><input aria-label="Descuento" className="input num" inputMode="decimal" value={it.discountPct} max={canOverride ? 99 : MAX_DISCOUNT} onChange={(e) => upd(i, { discountPct: e.target.value })} /></td>
                <td><button type="button" aria-label={`Quitar ${it.sku}`} className="btn btn-ghost icon-btn text-danger" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={16} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!canOverride && <p className="text-xs text-ink-soft">Descuento máximo por partida: {MAX_DISCOUNT}%. Precios especiales requieren autorización de gerencia.</p>}

      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="sm:w-1/2">
          <label className="label" htmlFor="notes">Notas / condiciones</label>
          <textarea id="notes" name="notes" rows={3} className="input" defaultValue={initial?.notes} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm sm:min-w-64 sm:self-end">
          <dt className="text-ink-soft">Subtotal</dt><dd className="num">{t.sub}</dd>
          <dt className="text-ink-soft">Descuento</dt><dd className="num">-{t.disc}</dd>
          <dt className="text-ink-soft">IVA</dt><dd className="num">{t.tax}</dd>
          <dt className="font-semibold">Total (estimado)</dt><dd className="num font-semibold">{t.total}</dd>
        </dl>
      </div>

      {/* Móvil: total y guardar siempre visibles (barra pegada al borde inferior del formulario) */}
      <div className="sticky bottom-0 z-10 -mx-4 -mb-4 flex flex-col gap-2 border-t border-line bg-panel px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:static sm:mx-0 sm:mb-0 sm:flex-row sm:items-center sm:border-0 sm:bg-transparent sm:p-0">
        <div className="flex items-baseline justify-between gap-3 sm:hidden">
          <span className="text-sm text-ink-soft">Total ({items.length} {items.length === 1 ? "partida" : "partidas"})</span>
          <span className="num text-lg font-semibold">{t.total}</span>
        </div>
        <Button className="w-full sm:w-auto" disabled={pending || items.length === 0}>{pending ? "Guardando…" : "Guardar cotización"}</Button>
        {state && !state.ok && <p role="alert" className="text-sm text-danger">{state.error}{state.fieldErrors && ` ${Object.values(state.fieldErrors).flat().join(" ")}`}</p>}
      </div>
    </form>
  );
}
