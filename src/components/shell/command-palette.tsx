"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface Hit { group: string; title: string; detail?: string; href: string }

/** Búsqueda global (Ctrl/⌘+K): cotizaciones, ventas, clientes y productos. Flechas para moverse, Enter para abrir. */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0); else { setQ(""); setHits([]); } }, [open]);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/buscar?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (r.ok) { setHits((await r.json()).hits); setActive(0); }
      } catch { /* búsqueda cancelada o sin red */ } finally { setLoading(false); }
    }, 200);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [q]);

  const go = (h: Hit) => { setOpen(false); router.push(h.href); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    if (e.key === "Enter" && hits[active]) { e.preventDefault(); go(hits[active]); }
  };

  let lastGroup = "";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="Buscar (Ctrl+K)" className="search-trigger">
        <Search size={16} strokeWidth={1.75} aria-hidden />
        <span className="hidden lg:inline">Buscar…</span>
        <kbd className="hidden lg:inline">Ctrl K</kbd>
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Buscar">
        <div className="p-3">
          <input
            ref={input} type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown}
            placeholder="Folio (C-12, V-3), cliente, RFC, SKU o descripción" aria-label="Buscar en el sistema"
            role="combobox" aria-expanded={hits.length > 0} aria-controls={listId}
            aria-activedescendant={hits[active] ? `${listId}-${active}` : undefined} className="input"
          />
        </div>
        <ul id={listId} role="listbox" className="max-h-[60dvh] overflow-y-auto px-2 pb-3">
          {hits.map((h, i) => {
            const header = h.group !== lastGroup ? (lastGroup = h.group) : null;
            return (
              <li key={h.href} role="presentation">
                {header && <p className="px-2 pb-1 pt-3 text-xs font-medium text-muted">{header}</p>}
                <button
                  id={`${listId}-${i}`} type="button" role="option" aria-selected={i === active}
                  onMouseEnter={() => setActive(i)} onClick={() => go(h)}
                  className={cn("flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm", i === active && "bg-accent-soft")}
                >
                  <span className="font-medium text-ink">{h.title}</span>
                  {h.detail && <span className="w-full truncate text-xs text-ink-soft">{h.detail}</span>}
                </button>
              </li>
            );
          })}
          {q.trim().length >= 2 && !loading && hits.length === 0 && <li className="px-2 py-6 text-center text-sm text-ink-soft">Sin resultados para «{q}».</li>}
          {q.trim().length < 2 && <li className="px-2 py-6 text-center text-sm text-muted">Escribe al menos 2 caracteres.</li>}
        </ul>
      </Dialog>
    </>
  );
}
