"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Trash2, X } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { Button } from "@/components/ui";
import { searchProductsAction } from "@/modules/products/actions";
import { suggestFor, warrantyText, type ComplementOption, type QuoteComplement } from "@/modules/complements/match";

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

const copy = (o: ComplementOption): QuoteComplement => ({ code: o.code, name: o.name, activities: [...o.activities] });

/** Agrega los paquetes sugeridos por SKU que aún no estén elegidos. */
function withSuggestions(current: QuoteComplement[], options: ComplementOption[], items: { sku: string; description: string }[]) {
  const next = [...current];
  for (const it of items) for (const o of suggestFor(options, it.sku, it.description)) if (!next.some((c) => c.code === o.code)) next.push(copy(o));
  return next;
}

const CUSTOM = "__custom__";
const isCustom = (code: string) => code.startsWith("PERSONALIZADO");
const customCode = (xs: QuoteComplement[]) => {
  const n = xs.filter((c) => isCustom(c.code)).length;
  return n ? `PERSONALIZADO-${n + 1}` : "PERSONALIZADO";
};

function Complements({ options, selected, setSelected, canCustomize }: {
  options: ComplementOption[];
  canCustomize: boolean;
  selected: QuoteComplement[];
  setSelected: (fn: (xs: QuoteComplement[]) => QuoteComplement[]) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const available = options.filter((o) => !selected.some((c) => c.code === o.code));
  const patch = (code: string, activities: string[]) => setSelected((xs) => xs.map((c) => (c.code === code ? { ...c, activities } : c)));
  return (
    <section aria-labelledby="complements-title" className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="complements-title" className="label mb-0">Complementos</h2>
          <p className="text-xs text-ink-soft">Alcance incluido que se imprime en el PDF. Se sugieren según el SKU o la descripción de las partidas.</p>
        </div>
        <select className="input w-full min-w-0 sm:w-auto sm:max-w-xs" value="" aria-label="Agregar paquete de complementos"
          onChange={(e) => {
            const v = e.target.value;
            if (v === CUSTOM) return setSelected((xs) => [...xs, { code: customCode(xs), name: "Personalizado", activities: [] }]);
            const o = options.find((x) => x.code === v);
            if (o) setSelected((xs) => [...xs, copy(o)]);
          }}>
          <option value="">+ Agregar paquete…</option>
          {available.map((o) => <option key={o.code} value={o.code}>{o.code} · {o.name}</option>)}
          {canCustomize && <option value={CUSTOM}>Personalizado (actividades a mano)</option>}
        </select>
      </div>
      {selected.length === 0 && <p className="rounded border border-dashed border-line p-3 text-sm text-ink-soft">Sin complementos.</p>}
      {selected.map((c) => {
        const base = options.find((o) => o.code === c.code)?.activities ?? [];
        const all = [...base, ...c.activities.filter((a) => !base.includes(a))];
        const toggle = (a: string, on: boolean) => patch(c.code, all.filter((x) => (x === a ? on : c.activities.includes(x))));
        const addCustom = () => {
          const v = (draft[c.code] ?? "").trim();
          if (v && !c.activities.includes(v)) patch(c.code, [...c.activities, v]);
          setDraft((d) => ({ ...d, [c.code]: "" }));
        };
        return (
          <div key={c.code} className="rounded border border-line p-3">
            <div className="flex items-start justify-between gap-2">
              {isCustom(c.code) ? (
                <input className="input min-w-0 flex-1" maxLength={120} value={c.name} aria-label="Nombre del paquete personalizado"
                  onChange={(e) => setSelected((xs) => xs.map((x) => (x.code === c.code ? { ...x, name: e.target.value } : x)))} />
              ) : (
                <p className="min-w-0 text-sm break-words"><b>{c.code}</b> · {c.name} <span className="text-xs text-ink-soft">({c.activities.length}/{all.length})</span></p>
              )}
              <button type="button" className="tap -m-2 p-2 text-ink-soft hover:text-danger" aria-label={`Quitar ${c.code}`} onClick={() => setSelected((xs) => xs.filter((x) => x.code !== c.code))}><X size={16} /></button>
            </div>
            {isCustom(c.code) && canCustomize && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                <label className="tap flex items-center gap-2"><input type="checkbox" checked={!!c.saveAs}
                  onChange={(e) => setSelected((xs) => xs.map((x) => (x.code === c.code ? { ...x, saveAs: e.target.checked ? { shared: true } : undefined } : x)))} />
                  Guardar en paquetes</label>
                {c.saveAs && <label className="tap flex items-center gap-2"><input type="checkbox" checked={c.saveAs.shared}
                  onChange={(e) => setSelected((xs) => xs.map((x) => (x.code === c.code ? { ...x, saveAs: { shared: e.target.checked } } : x)))} />
                  Habilitado para los demás usuarios</label>}
              </div>
            )}
            {all.length > 0 && (
              <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {all.map((a) => (
                  <li key={a} className="min-w-0"><label className="flex items-start gap-2 text-sm break-words"><input type="checkbox" className="mt-1" checked={c.activities.includes(a)} onChange={(e) => toggle(a, e.target.checked)} />{a}</label></li>
                ))}
              </ul>
            )}
            {canCustomize && <div className="mt-2 flex gap-2">
              <input className="input min-w-0 flex-1" maxLength={300} value={draft[c.code] ?? ""} placeholder="Agregar actividad" aria-label={`Agregar actividad a ${c.code}`}
                onChange={(e) => setDraft((d) => ({ ...d, [c.code]: e.target.value }))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCustom(); } }} />
              <Button type="button" variant="secondary" onClick={addCustom}>Agregar</Button>
            </div>}
          </div>
        );
      })}
    </section>
  );
}

export function QuoteEditor({
  action, customers, initial, canOverride, complementOptions, canCustomize = false, sellers, defaultSellerId, canApproveDiscount = false,
}: {
  action: (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;
  customers: { id: string; legalName: string }[];
  initial?: {
    customerId: string; validUntil: string; notes: string; deliveryTime?: string; currency?: string;
    warrantyMonths?: number | null; complements: QuoteComplement[] | null; items: EditorItem[];
    sellerId?: string; discountNote?: string;
  };
  canOverride: boolean;
  /** Solo para administradores: permite asignar la cotización a otro vendedor. */
  sellers?: { id: string; name: string }[];
  defaultSellerId?: string;
  /** Administrador: su descuento no necesita autorización. */
  canApproveDiscount?: boolean;
  complementOptions: ComplementOption[];
  canCustomize?: boolean;
}) {
  const [items, setItems] = useState<EditorItem[]>(initial?.items ?? []);
  const [complements, setComplementsRaw] = useState<QuoteComplement[]>(
    () => initial?.complements ?? withSuggestions([], complementOptions, initial?.items ?? []),
  );
  // La garantía sigue al paquete de mayor garantía hasta que el vendedor la cambia a mano.
  const warrantyTouched = useRef(initial?.warrantyMonths != null);
  const suggestedWarranty = (cs: QuoteComplement[]) => {
    const ms = cs.map((c) => complementOptions.find((o) => o.code === c.code)?.warrantyMonths).filter((m): m is number => m != null);
    return ms.length ? String(Math.max(...ms)) : "";
  };
  const [warranty, setWarranty] = useState(() => initial?.warrantyMonths?.toString() ?? suggestedWarranty(complements));
  const setComplements = (fn: (xs: QuoteComplement[]) => QuoteComplement[]) => {
    const next = fn(complements);
    setComplementsRaw(next);
    if (!warrantyTouched.current) setWarranty(suggestedWarranty(next));
  };
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
    setComplements((cs) => withSuggestions(cs, complementOptions, [p]));
    setTerm("");
    setFound([]);
  };
  const upd = (i: number, patch: Partial<EditorItem>) => setItems((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const t = preview(items);
  const [globalDisc, setGlobalDisc] = useState("");
  const hasDiscount = items.some((x) => Number(x.discountPct) > 0);
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
      <input type="hidden" name="complements" value={JSON.stringify(complements)} />
      <div className="grid gap-3 sm:grid-cols-5">
        {sellers && (
          <div className="sm:col-span-2">
            <label className="label" htmlFor="sellerId">Vendedor asignado</label>
            <select id="sellerId" name="sellerId" className="input" defaultValue={initial?.sellerId ?? defaultSellerId} aria-describedby="seller-hint">
              {sellers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <p id="seller-hint" className="mt-1 text-xs text-ink-soft">La cotización aparece en la cartera y comisiones de este vendedor.</p>
          </div>
        )}
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
          <label className="label" htmlFor="currency">Moneda para el cliente</label>
          <select id="currency" name="currency" className="input" defaultValue={initial?.currency ?? "USD"} aria-describedby="currency-hint">
            <option value="USD">Dólares (USD)</option>
            <option value="MXN">Pesos (MXN)</option>
          </select>
          <p id="currency-hint" className="mt-1 text-xs text-ink-soft">Aquí se captura en MXN; el PDF y el correo salen en la moneda elegida al TC del día.</p>
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
        <div>
          <label className="label" htmlFor="warrantyMonths">Garantía (meses)</label>
          <input id="warrantyMonths" name="warrantyMonths" type="number" min={0} max={60} inputMode="numeric" className="input" value={warranty}
            onChange={(e) => { warrantyTouched.current = true; setWarranty(e.target.value); }} placeholder="3" aria-describedby="warranty-hint" />
          <p id="warranty-hint" className="mt-1 text-xs text-ink-soft">{warranty ? `Cláusula D: ${warrantyText(Number(warranty))}` : "Vacío = 3 meses"}</p>
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

      <section aria-labelledby="discount-title" className="space-y-2 rounded-md border border-line p-3">
        <h2 id="discount-title" className="label mb-0">Descuento (opcional)</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-ink-soft">Descuento %
            <input className="input num mt-1 w-28" inputMode="decimal" value={globalDisc} max={canOverride ? 99 : MAX_DISCOUNT} placeholder="0" onChange={(e) => setGlobalDisc(e.target.value)} />
          </label>
          <button type="button" className="btn btn-secondary" disabled={globalDisc === "" || items.length === 0} onClick={() => setItems((xs) => xs.map((x) => ({ ...x, discountPct: globalDisc })))}>Aplicar a todas las partidas</button>
        </div>
        <p className="text-xs text-ink-soft">También puedes poner un descuento distinto en cada partida.</p>
        {!canApproveDiscount && hasDiscount && (
          <div className="space-y-2">
            <p role="status" className="rounded border border-warn bg-warn-soft p-2 text-sm">Este descuento necesita la autorización de un administrador. Al guardar se les avisa, y podrás enviar la cotización cuando uno lo autorice.</p>
            <label className="block text-xs text-ink-soft">Motivo del descuento (lo ve el administrador)
              <textarea name="discountNote" className="input mt-1" rows={2} maxLength={500} defaultValue={initial?.discountNote} placeholder="Ej. Cliente frecuente, compra por volumen…" />
            </label>
          </div>
        )}
      </section>

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

      <Complements options={complementOptions} selected={complements} setSelected={setComplements} canCustomize={canCustomize} />

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
