"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";

interface Item { id: string; title: string; body: string | null; href: string | null; readAt: string | null; createdAt: string }

const rel = new Intl.RelativeTimeFormat("es-MX", { numeric: "auto" });
function ago(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return rel.format(-min, "minute");
  if (min < 1440) return rel.format(-Math.round(min / 60), "hour");
  return rel.format(-Math.round(min / 1440), "day");
}

/** Campana de avisos: contador de no leídos (se actualiza cada minuto) y panel con los últimos 20. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<{ items: Item[]; unread: number }>({ items: [], unread: 0 });
  const root = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const router = useRouter();

  const load = useCallback(async (init?: RequestInit) => {
    try {
      const r = await fetch("/api/avisos", { cache: "no-store", ...init });
      if (r.ok) setData(await r.json());
    } catch { /* sin red: se reintenta en el siguiente ciclo */ }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    load();
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, load]);

  const mark = (id?: string) => load({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(id ? { id } : {}) });
  const openItem = (n: Item) => {
    if (!n.readAt) mark(n.id);
    setOpen(false);
    if (n.href) router.push(n.href);
  };

  return (
    <div ref={root} className="relative">
      <button
        type="button" aria-label={data.unread ? `Avisos (${data.unread} sin leer)` : "Avisos"} aria-expanded={open} aria-controls={panelId}
        data-tip="Avisos" onClick={() => setOpen((o) => !o)} className="btn btn-ghost icon-btn relative"
      >
        <Bell size={18} strokeWidth={1.75} aria-hidden />
        {data.unread > 0 && <span key={data.unread} aria-hidden className="bell-badge">{data.unread > 9 ? "9+" : data.unread}</span>}
      </button>
      {open && (
        <div id={panelId} className="page-enter absolute right-0 top-full z-40 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-line bg-panel shadow-[var(--elev-pop)]">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <p className="text-sm font-semibold">Avisos</p>
            {data.unread > 0 && (
              <button type="button" onClick={() => mark()} className="btn btn-ghost btn-sm gap-1.5 text-accent-fg">
                <CheckCheck size={14} strokeWidth={1.75} aria-hidden /> Marcar todo leído
              </button>
            )}
          </div>
          <ul className="max-h-[60dvh] overflow-y-auto">
            {data.items.length === 0 && <li className="px-3 py-8 text-center text-sm text-ink-soft">Sin avisos por ahora.</li>}
            {data.items.map((n) => (
              <li key={n.id} className="border-b border-line last:border-0">
                <button type="button" onClick={() => openItem(n)} className={cn("flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-panel-2", !n.readAt && "bg-accent-soft/40")}>
                  <span aria-hidden className={cn("mt-1.5 size-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent-fg")} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink">{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-ink-soft">{n.body}</span>}
                    <span className="block text-xs text-muted">{ago(n.createdAt)}{!n.readAt && <span className="sr-only"> · sin leer</span>}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
