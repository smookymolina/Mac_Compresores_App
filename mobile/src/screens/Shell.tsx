import { useEffect, useState, type ReactNode } from "react";
import { APP_VERSION, API_URL, useApp } from "../core";
import { Alert, Badge, Button, Card, Confirm, Facts } from "../ui/kit";
import { timeAgo } from "../ui/format";
import { CatalogList, ProductDetail } from "./Catalog";
import { CustomerDetail, CustomerList } from "./Customers";
import { IssuesCard, QuoteDetail, QuoteEditor, QuoteList } from "./Quotes";

type Tab = "catalog" | "quotes" | "customers" | "more";
type View = { tab: Tab; detail?: string; edit?: { quoteId?: string; customerId?: string }; notice?: string };

/** Re-render periódico para «hace N min». */
function useNow(ms = 30_000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function StatusBar() {
  const app = useApp();
  const now = useNow();
  const st = app.status === "syncing"
    ? { icon: "🔄", label: "Sincronizando…" }
    : app.status === "online" ? { icon: "🟢", label: "En línea" } : { icon: "🟠", label: "Sin conexión" };
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-panel shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-2 px-4">
        <div className="min-w-0" role="status" aria-live="polite">
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-ink">
            <span className="truncate"><span aria-hidden>{st.icon}</span> {st.label}</span>
            {app.pendingCount > 0 && <Badge tone="warn"><span aria-label={`${app.pendingCount} cambios por enviar`}>{app.pendingCount} por enviar</span></Badge>}
          </p>
          <p className="truncate text-xs text-muted">Última sincronización: {timeAgo(app.lastSyncAt, now)}</p>
        </div>
        <Button variant="ghost" className="shrink-0 px-3 text-sm" busy={app.status === "syncing"} disabled={app.status === "offline"} onClick={() => void app.syncNow()}>
          Sincronizar ahora
        </Button>
      </div>
      {!app.canCapture && (
        <div className="bg-warn-soft px-4 py-2 text-sm text-warn" role="alert">Llevas más de 7 días sin sincronizar. Solo puedes consultar hasta que sincronices.</div>
      )}
      {app.error && app.status !== "syncing" && <div className="bg-danger-soft px-4 py-2 text-sm text-danger">{app.error}</div>}
    </header>
  );
}

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "catalog", label: "Catálogo", icon: <path d="M4 5h16M4 12h16M4 19h10" /> },
  { id: "quotes", label: "Cotizaciones", icon: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></> },
  { id: "customers", label: "Clientes", icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></> },
  { id: "more", label: "Más", icon: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></> },
];

function BottomNav({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Principal">
      <ul className="grid grid-cols-4">
        {TABS.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => onTab(t.id)}
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight ${tab === t.id ? "text-brand" : "text-muted"}`}
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>{t.icon}</svg>
              {t.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function More({ onOpenQuote }: { onOpenQuote: (id: string) => void }) {
  const app = useApp();
  const [ask, setAsk] = useState(false);
  return (
    <div className="space-y-3">
      <Card title="Usuario">
        <Facts rows={[["Nombre", app.user?.name], ["Correo", app.user?.email], ["Rol", app.user?.roleName]]} />
      </Card>
      <IssuesCard onOpen={onOpenQuote} />
      <Card title="Aplicación">
        <Facts rows={[["Versión", APP_VERSION], ["Servidor", API_URL.replace(/^https?:\/\//, "")], ["Pendientes por enviar", String(app.pending)]]} />
      </Card>
      <Button variant="secondary" className="w-full" onClick={() => app.lock()}>Bloquear ahora</Button>
      <Button variant="danger" className="w-full" onClick={() => setAsk(true)}>Cerrar sesión</Button>
      <Confirm
        open={ask}
        title="¿Cerrar sesión?"
        body={<>Se borrarán los datos guardados en este teléfono y tendrás que volver a iniciar sesión y descargar el catálogo.{app.pending > 0 && <Alert tone="warn">Hay {app.pending} cambios sin enviar que se perderán.</Alert>}</>}
        confirmLabel="Cerrar sesión"
        onCancel={() => setAsk(false)}
        onConfirm={() => { setAsk(false); void app.logout(); }}
      />
    </div>
  );
}

export function Shell() {
  const [view, setView] = useState<View>({ tab: "catalog" });

  // Botón «atrás» de Android: cierra el detalle antes de salir.
  useEffect(() => {
    let remove: (() => void) | undefined;
    let alive = true;
    void import("@capacitor/app").then(({ App }) => App.addListener("backButton", ({ canGoBack }) => {
      setView((v) => {
        if (v.edit) return v.edit.quoteId ? { tab: v.tab, detail: v.edit.quoteId } : { tab: v.tab };
        if (v.detail) return { tab: v.tab };
        if (v.tab !== "catalog") return { tab: "catalog" };
        if (!canGoBack) void App.minimizeApp();
        return v;
      });
    })).then((h) => { if (alive) remove = () => void h.remove(); else void h.remove(); }).catch(() => {});
    return () => { alive = false; remove?.(); };
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  const backTo: View | null = view.edit ? (view.edit.quoteId ? { tab: view.tab, detail: view.edit.quoteId } : { tab: view.tab }) : view.detail ? { tab: view.tab } : null;
  const backLabel = view.edit?.quoteId ? "Cotización" : ({ catalog: "Catálogo", quotes: "Cotizaciones", customers: "Clientes", more: "Más" } as const)[view.tab];
  const back = backTo && (
    <button type="button" onClick={() => setView(backTo)} className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 px-2 font-medium text-accent-fg">
      <span aria-hidden>‹</span> {backLabel}
    </button>
  );
  const openQuote = (id: string) => setView({ tab: "quotes", detail: id });

  return (
    <div className="min-h-dvh overflow-x-hidden">
      <StatusBar />
      <main className="mx-auto w-full max-w-2xl px-4 pb-24 pt-3">
        {back}
        {view.tab === "catalog" && (view.detail ? <ProductDetail id={view.detail} /> : <CatalogList onOpen={(id) => setView({ tab: "catalog", detail: id })} />)}
        {view.tab === "quotes" && (view.edit ? (
          <QuoteEditor
            key={view.edit.quoteId ?? `new:${view.edit.customerId ?? ""}`}
            quoteId={view.edit.quoteId}
            customerId={view.edit.customerId}
            onSaved={(id) => setView({ tab: "quotes", detail: id, notice: "Guardada en el teléfono; se enviará al sincronizar." })}
            onCancel={() => backTo && setView(backTo)}
          />
        ) : view.detail ? (
          <QuoteDetail key={view.detail} id={view.detail} notice={view.notice} onEdit={(id) => setView({ tab: "quotes", edit: { quoteId: id } })} />
        ) : (
          <QuoteList onOpen={openQuote} onNew={() => setView({ tab: "quotes", edit: {} })} />
        ))}
        {view.tab === "customers" && (view.detail ? (
          <CustomerDetail id={view.detail} onOpenQuote={openQuote} onNewQuote={(customerId) => setView({ tab: "quotes", edit: { customerId } })} />
        ) : <CustomerList onOpen={(id) => setView({ tab: "customers", detail: id })} />)}
        {view.tab === "more" && <More onOpenQuote={openQuote} />}
      </main>
      <BottomNav tab={view.tab} onTab={(t) => setView({ tab: t })} />
    </div>
  );
}
