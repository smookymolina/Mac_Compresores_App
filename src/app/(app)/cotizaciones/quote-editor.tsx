"use client";

import { useActionState, useState, useTransition } from "react";
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

export function QuoteEditor({
  action, customers, initial, canOverride,
}: {
  action: (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  customers: { id: string; legalName: string }[];
  initial?: { customerId: string; validUntil: string; notes: string; items: EditorItem[] };
  canOverride: boolean;
}) {
  const [items, setItems] = useState<EditorItem[]>(initial?.items ?? []);
  const [term, setTerm] = useState("");
  const [found, setFound] = useState<Found[]>([]);
  const [searching, startSearch] = useTransition();
  const [, startSubmit] = useTransition();
  const [state, formAction, pending] = useActionState(action, null);
  const defaultValid = new Date(Date.now() + 15 * 864e5).toISOString().slice(0, 10);

  const search = (t: string) => {
    setTerm(t);
    if (t.trim().length < 2) return setFound([]);
    startSearch(async () => setFound(await searchProductsAction(t)));
  };
  const add = (p: Found) => {
    setItems((xs) => [...xs, {
      productId: p.id, sku: p.sku, description: p.description, unit: p.unit, listPrice: p.price,
      taxRate: p.taxRate, quantity: "1", discountPct: "0", unitPrice: "",
    }]);
    setTerm("");
    setFound([]);
  };
  const upd = (i: number, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const t = preview(items);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault(); // evita el reseteo automático del formulario en React 19
        const fd = new FormData(e.currentTarget);
        startSubmit(() => formAction(fd));
      }}
    >
      <input type="hidden" name="items" value={JSON.stringify(items.map(({ productId, quantity, discountPct, unitPrice }) => ({ productId, quantity, discountPct, unitPrice })))} />
      <div className="grid gap-3 sm:grid-cols-3">
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
      </div>

      <div className="relative">
        <label className="label" htmlFor="search">Agregar producto o servicio</label>
        <input id="search" className="input" value={term} onChange={(e) => search(e.target.value)} placeholder="Busca por SKU, descripción o no. de parte (mín. 2 caracteres)" autoComplete="off" />
        {(found.length > 0 || searching) && (
          <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-line bg-panel shadow-lg">
            {searching && <li className="px-3 py-2 text-sm text-ink-soft">Buscando…</li>}
            {found.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => add(p)} className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-surface">
                  <span><b>{p.sku}</b> — {p.description}</span>
                  <span className="shrink-0 tabular-nums">{Number(p.price) > 0 ? `$${p.price}` : "sin precio"}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="overflow-x-auto rounded-md border border-line">
        <table className="table">
          <thead>
            <tr><th>#</th><th>Concepto</th><th className="num">Cant.</th><th className="num">Precio lista</th>{canOverride && <th className="num">Precio especial</th>}<th className="num">Desc. %</th><th /></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-ink-soft">Sin partidas.</td></tr>}
            {items.map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td><b>{it.sku}</b><div className="text-xs text-ink-soft">{it.description}</div></td>
                <td className="w-24"><input aria-label="Cantidad" className="input num" inputMode="decimal" value={it.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} /></td>
                <td className="num">${it.listPrice}</td>
                {canOverride && <td className="w-32"><input aria-label="Precio especial" className="input num" inputMode="decimal" placeholder="—" value={it.unitPrice} onChange={(e) => upd(i, { unitPrice: e.target.value })} /></td>}
                <td className="w-24"><input aria-label="Descuento" className="input num" inputMode="decimal" value={it.discountPct} max={canOverride ? 99 : MAX_DISCOUNT} onChange={(e) => upd(i, { discountPct: e.target.value })} /></td>
                <td><button type="button" aria-label="Quitar" className="text-danger" onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}><Trash2 size={16} /></button></td>
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
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 self-end text-sm">
          <dt className="text-ink-soft">Subtotal</dt><dd className="num">{t.sub}</dd>
          <dt className="text-ink-soft">Descuento</dt><dd className="num">-{t.disc}</dd>
          <dt className="text-ink-soft">IVA</dt><dd className="num">{t.tax}</dd>
          <dt className="font-semibold">Total (estimado)</dt><dd className="num font-semibold">{t.total}</dd>
        </dl>
      </div>

      <div className="flex items-center gap-3">
        <Button disabled={pending || items.length === 0}>{pending ? "Guardando…" : "Guardar cotización"}</Button>
        {state && !state.ok && <p role="alert" className="text-sm text-danger">{state.error}{state.fieldErrors && ` ${Object.values(state.fieldErrors).flat().join(" ")}`}</p>}
      </div>
    </form>
  );
}
