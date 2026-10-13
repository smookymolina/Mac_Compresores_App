"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Info, RefreshCw, Search, SearchX, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState, ErrorState } from "@/components/ui/data";
import { CaptureShield, shieldSrc, useShieldHidden } from "@/components/partners/capture-shield";
import { searchPricesAction, type PartnerSearchItem } from "@/modules/partners/portal-actions";
import { ContactLine, type PortalContact } from "./contact";

const MIN_CHARS = 3; // = PARTNER_SEARCH_MIN (el módulo del servidor no se importa en cliente)
const DEBOUNCE_MS = 400;
const SKELETON_AFTER_MS = 300;
const REFRESH_MS = 50_000; // las URLs firmadas duran 60 s
const PAUSE_S = 60;
const TAKE = 20;

type Status = "idle" | "loading" | "results" | "empty" | "error";

export interface PriceSearchProps {
  remaining: number;
  quota: number;
  /** dd/mm/aaaa del próximo reinicio de la cuota (hora de Ciudad de México). */
  resetOn: string;
  contact?: PortalContact;
}

function Legend({ contact }: { contact?: PortalContact }) {
  return (
    <div className="mt-6 text-xs text-muted">
      <p>Precios sin IVA · moneda indicada por producto</p>
      {/* Los precios son imagen (anti-extracción); quien usa lector de pantalla los pide por correo. */}
      <p className="mt-1">¿Usas lector de pantalla o no ves los precios? Escríbenos y te los enviamos.</p>
      <ContactLine contact={contact} />
    </div>
  );
}

function PriceImg({ src, onFail }: { src: string; onFail: () => void }) {
  const hidden = useShieldHidden();
  // eslint-disable-next-line @next/next/no-img-element -- PNG firmado y de un solo uso: no debe pasar por el optimizador
  return <img src={shieldSrc(src, hidden)} alt="Precio protegido: precio normal y tu precio con descuento" width={144} draggable={false} className="portal-img" onError={hidden ? undefined : onFail} />;
}

function Results({ items, stale, onFail }: { items: PartnerSearchItem[]; stale: boolean; onFail: () => void }) {
  return (
    <table className="table portal-table" role="table">
      <caption className="sr-only">Precios de socio</caption>
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Descripción</th>
          <th scope="col">Unidad</th>
          <th scope="col">Moneda</th>
          <th scope="col" className="num">Precio normal → tu precio</th>
        </tr>
      </thead>
      <tbody role="rowgroup">
        {items.map((it) => (
          // role explícitos: en móvil las filas son grid y Safari pierde la semántica de tabla.
          <tr key={it.key} role="row">
            <td role="cell" data-col="sku" className="mono"><span className="sr-only md:hidden">SKU: </span>{it.sku}</td>
            <td role="cell" data-col="desc" title={it.description}><span className="sr-only md:hidden">Descripción: </span>{it.description}</td>
            <td role="cell" data-col="unit"><span className="md:hidden">Unidad: </span>{it.unit}</td>
            <td role="cell" data-col="cur"><span className="sr-only md:hidden">Moneda: </span><Badge tone={it.currency === "USD" ? "blue" : "neutral"}>{it.currency}</Badge></td>
            <td role="cell" data-col="price" className="num"><span className="sr-only md:hidden">Precio de socio: </span>
              {stale ? <span className="portal-price" role="img" aria-label="Precio no disponible: actualiza la búsqueda" /> : <PriceImg src={it.img} onFail={onFail} />}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ResultsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" className="divide-y divide-line">
      <span className="sr-only">Buscando precios…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="space-y-2 px-4 py-3">
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-8 w-36 justify-self-end" />
        </div>
      ))}
    </div>
  );
}

export function PriceSearch({ remaining: initialRemaining, quota, resetOn, contact }: PriceSearchProps) {
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [items, setItems] = useState<PartnerSearchItem[]>([]);
  const [shownQ, setShownQ] = useState("");
  const [remaining, setRemaining] = useState(initialRemaining);
  const [slow, setSlow] = useState(false);
  const [stale, setStale] = useState(false);
  const [pause, setPause] = useState(0);
  const [blocked, setBlocked] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const seq = useRef(0);
  const lastQ = useRef("");
  const slowTimer = useRef<number>(undefined);
  const staleTimer = useRef<number>(undefined);
  const interacted = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const runRef = useRef<(q: string, silent?: boolean) => Promise<void>>(async () => {});

  const quotaOut = remaining <= 0;

  const run = useCallback(async (raw: string, silent = false) => {
    const q = raw.trim().replace(/\s+/g, " ");
    if (q.length < MIN_CHARS) return;
    const id = ++seq.current;
    lastQ.current = q;
    window.clearTimeout(staleTimer.current);
    window.clearTimeout(slowTimer.current);
    if (!silent) {
      setStatus("loading");
      setSlow(false);
      slowTimer.current = window.setTimeout(() => id === seq.current && setSlow(true), SKELETON_AFTER_MS);
    }
    try {
      const r = await searchPricesAction(q);
      if (id !== seq.current) return;
      window.clearTimeout(slowTimer.current);
      setSlow(false);
      if (r.ok && r.data) {
        setItems(r.data.items);
        setShownQ(q);
        setRemaining(r.data.remaining);
        setStale(false);
        setStatus(r.data.items.length ? "results" : "empty");
        interacted.current = false;
        // Las URLs firmadas vencen a los 60 s: refresca si el socio sigue activo en pantalla; si no, pide actualizar.
        staleTimer.current = window.setTimeout(() => {
          const present = document.visibilityState === "visible" && document.hasFocus() && interacted.current;
          if (present) void runRef.current(lastQ.current, true);
          else setStale(true);
        }, REFRESH_MS);
        return;
      }
      const msg = r.ok ? "" : r.error;
      if (/sesi[oó]n (expir|de acceso)/i.test(msg)) {
        window.location.assign("/socios/login?motivo=inactividad");
      } else if (/bloquead|actividad inusual/i.test(msg)) {
        setBlocked(true);
        setItems([]);
      } else if (/l[ií]mite de consultas/i.test(msg)) {
        setRemaining(0);
        setStatus(items.length ? "results" : "idle");
      } else if (/muy r[aá]pido|demasiadas consultas/i.test(msg)) {
        setPause(PAUSE_S);
        setStatus(items.length ? "results" : "idle");
      } else {
        setErrorMsg(msg);
        setStatus("error");
      }
    } catch {
      if (id !== seq.current) return;
      window.clearTimeout(slowTimer.current);
      setSlow(false);
      setErrorMsg("");
      setStatus("error");
    }
  }, [items.length]);

  useEffect(() => {
    runRef.current = run;
  }, [run]);

  // Presencia: solo un gesto reciente del socio autoriza el refresco silencioso (cada refresco gasta una búsqueda).
  useEffect(() => {
    const mark = () => { interacted.current = true; };
    const evs = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    return () => {
      evs.forEach((e) => window.removeEventListener(e, mark));
      window.clearTimeout(staleTimer.current);
      window.clearTimeout(slowTimer.current);
    };
  }, []);

  // Debounce 400 ms con mínimo de 3 caracteres.
  useEffect(() => {
    const t = term.trim().replace(/\s+/g, " ");
    if (t.length < MIN_CHARS || t === lastQ.current || pause > 0 || quotaOut || blocked) return;
    // Si Enter ya lanzó esta misma búsqueda (lastQ es ref, el efecto no se entera), no se repite: cada una gasta cuota.
    const id = window.setTimeout(() => { if (t !== lastQ.current) void run(t); }, DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [term, run, pause, quotaOut, blocked]);

  // Cuenta regresiva del límite por minuto.
  useEffect(() => {
    if (pause <= 0) return;
    const id = window.setTimeout(() => setPause((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [pause]);

  const reset = () => {
    seq.current++;
    lastQ.current = "";
    window.clearTimeout(staleTimer.current);
    setItems([]);
    setStatus("idle");
    setSlow(false);
    setStale(false);
  };

  const onChange = (v: string) => {
    setTerm(v);
    if (v.trim().length < MIN_CHARS && status !== "idle") reset();
  };

  const clear = () => {
    setTerm("");
    reset();
    input.current?.focus();
  };

  const refresh = () => void run(lastQ.current || term);
  const searchDisabled = quotaOut || pause > 0 || blocked;
  const canSubmit = term.trim().length >= MIN_CHARS && !searchDisabled;
  const showSkeleton = status === "loading" && slow;
  const showItems = (status === "results" || (status === "loading" && !slow)) && items.length > 0;

  return (
    <>
      <CaptureShield id="contenido" className="portal-main" onReveal={() => lastQ.current && void runRef.current(lastQ.current, true)}>
        {blocked ? (
          <section aria-labelledby="blk" className="portal-card">
            <EmptyState icon={ShieldAlert} title="Tu cuenta está bloqueada">
              <span id="blk" className="sr-only">Cuenta bloqueada</span>
              <p>Por seguridad pausamos tu acceso. Contacta a MAC Compresores para reactivarlo.</p>
              <div className="mt-2"><ContactLine contact={contact} /></div>
            </EmptyState>
          </section>
        ) : (
          <>
            <form
              role="search" onSubmit={(e) => { e.preventDefault(); if (canSubmit) void run(term); }}
              className="portal-card flex flex-col gap-3 p-4"
            >
              <div>
                <label htmlFor="q" className="label">Buscar producto</label>
                <div className="flex gap-2">
                  <input
                    ref={input} id="q" name="q" type="text" inputMode="search" enterKeyHint="search" className="input min-w-0 flex-1"
                    placeholder="SKU o descripción" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={60}
                    value={term} onChange={(e) => onChange(e.target.value)} disabled={searchDisabled} aria-describedby="q-hint"
                  />
                  <button type="submit" className="btn btn-primary gap-2" disabled={!canSubmit}>
                    <Search size={16} strokeWidth={1.75} aria-hidden /> Buscar
                  </button>
                </div>
                <p id="q-hint" className="mt-1 text-xs text-muted">Escribe al menos 3 caracteres: SKU o descripción</p>
              </div>
              {/* Solo se anuncia al acercarse al límite; antes sería ruido en cada búsqueda. */}
              <p aria-live="polite" className="sr-only">{remaining <= 10 ? (quotaOut ? "Aviso: ya no tienes búsquedas disponibles hoy" : `Aviso: solo ${remaining === 1 ? "queda 1 búsqueda" : `quedan ${remaining} búsquedas`} por hoy`) : ""}</p>
              <div className="text-xs text-ink-soft">
                {remaining <= 10 ? (
                  quotaOut ? <span>0 de {quota} búsquedas hoy</span> : <Badge tone="amber">Te quedan {remaining} búsquedas hoy</Badge>
                ) : (
                  <span>Te quedan {remaining} de {quota} búsquedas hoy</span>
                )}
              </div>
              {pause > 0 && <p role="status" className="text-sm text-ink-soft">Haz una pausa de {pause} segundos para seguir buscando.</p>}
            </form>

            <section aria-label="Resultados" className="portal-card mt-4 overflow-hidden">
              <div role="status" className="sr-only">
                {status === "results" ? `${items.length === 1 ? "1 resultado" : `${items.length} resultados`}` : status === "empty" ? "Sin resultados" : ""}
              </div>
              {quotaOut && (
                <div className="border-b border-line">
                  <EmptyState icon={Clock} title="Llegaste al límite de búsquedas de hoy">
                    <p>Tu cuota ({quota} búsquedas) se reinicia hoy a las 12:00 a. m., hora de Ciudad de México ({resetOn}). ¿Necesitas más? Contacta a MAC Compresores.</p>
                    <div className="mt-2"><ContactLine contact={contact} /></div>
                  </EmptyState>
                </div>
              )}
              {showSkeleton && <ResultsSkeleton />}
              {status === "error" && (
                <ErrorState
                  title="No pudimos buscar en este momento."
                  action={<button type="button" className="btn btn-secondary gap-2" onClick={refresh}><RefreshCw size={16} strokeWidth={1.75} aria-hidden /> Reintentar</button>}
                >
                  {errorMsg && !/^Escribe/.test(errorMsg) ? errorMsg : "Revisa tu conexión e inténtalo de nuevo."}
                </ErrorState>
              )}
              {status === "empty" && !showSkeleton && (
                <EmptyState icon={SearchX} title={`No encontramos “${shownQ}”`} action={<button type="button" className="btn btn-secondary" onClick={clear}>Borrar búsqueda</button>}>
                  Revisa el SKU o prueba con otra parte de la descripción.
                </EmptyState>
              )}
              {showItems && !showSkeleton && (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2 text-sm">
                    <h2 className="font-medium">{items.length === 1 ? "1 resultado" : `${items.length} resultados`}</h2>
                    {items.length >= TAKE && (
                      <p className="flex items-center gap-1 text-xs text-ink-soft"><Info size={14} strokeWidth={1.75} aria-hidden /> Mostrando hasta {TAKE} resultados; afina tu búsqueda</p>
                    )}
                  </div>
                  {stale && (
                    <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warn-soft px-4 py-2 text-sm text-warn">
                      <span>Actualiza para ver precios</span>
                      <button type="button" className="btn btn-secondary gap-2" onClick={refresh}><RefreshCw size={16} strokeWidth={1.75} aria-hidden /> Actualizar</button>
                    </div>
                  )}
                  <Results items={items} stale={stale} onFail={() => setStale(true)} />
                </>
              )}
              {status === "idle" && !quotaOut && <p className="px-4 py-6 text-center text-sm text-ink-soft">Busca por SKU o descripción para ver tus precios de socio.</p>}
            </section>
          </>
        )}
        <Legend contact={contact} />
        {/* Señuelos: invisibles y fuera del orden de tabulación. Entrar aquí bloquea la cuenta. */}
        <span className="portal-hp" aria-hidden="true">
          <a href="/socios/catalogo-completo" rel="nofollow" tabIndex={-1}>Catálogo completo</a>
          <a href="/socios/api-precios" rel="nofollow" tabIndex={-1}>Lista de precios</a>
        </span>
      </CaptureShield>
    </>
  );
}
