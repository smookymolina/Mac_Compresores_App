import { useEffect, useRef, useState, type ReactNode } from "react";
import { API_URL, useApp, type SyncIssue } from "../core";
import { Alert, AuthScreen, Badge, Button, Card, Confirm, Facts, errMsg } from "../ui/kit";
import { timeAgo } from "../ui/format";
import { CatalogList, ProductDetail } from "./Catalog";
import { CustomerDetail, CustomerForm, CustomerList } from "./Customers";
import { InventoryScreen } from "./Inventory";
import { IssuesCard } from "./Issues";
import { QuoteDetail, QuoteEditor, QuoteList } from "./Quotes";
import { SaleDetail, SaleList } from "./Sales";

type Tab = "catalog" | "quotes" | "customers" | "sales" | "inventory" | "more";
type View = { tab: Tab; detail?: string; edit?: { quoteId?: string; customerId?: string }; customerForm?: { id?: string }; notice?: string };

const TAB_LABEL: Record<Tab, string> = { catalog: "Catálogo", quotes: "Cotizaciones", customers: "Clientes", sales: "Ventas", inventory: "Inventario", more: "Más" };

/** Pestañas visibles según permisos: almacén sin cotizaciones/ventas → Catálogo · Inventario · Más. */
function navTabs(can: (p: string) => boolean): Tab[] {
  const quotes = can("quotes.read_own") || can("quotes.read_all");
  const sales = can("sales.read_own") || can("sales.read_all");
  if (!quotes && !sales) return can("inventory.read") ? ["catalog", "inventory", "more"] : ["catalog", "more"];
  return ["catalog", ...(quotes ? (["quotes"] as Tab[]) : []), ...(can("customers.read") ? (["customers"] as Tab[]) : []), ...(sales ? (["sales"] as Tab[]) : []), "more"];
}

/** Vista «atrás» (null si ya está en la raíz de una pestaña visible). */
function parentOf(v: View, tabs: Tab[]): View | null {
  if (v.edit) return v.edit.quoteId ? { tab: v.tab, detail: v.edit.quoteId } : { tab: v.tab };
  if (v.customerForm) return v.customerForm.id ? { tab: "customers", detail: v.customerForm.id } : { tab: "customers" };
  if (v.detail) return { tab: v.tab };
  if (!tabs.includes(v.tab)) return { tab: "more" };
  return null;
}

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
      {app.stalePending && (
        <div className="bg-danger-soft px-4 py-2 text-sm font-medium text-danger" role="alert">
          Tienes {app.stalePending.count} {app.stalePending.count === 1 ? "cambio" : "cambios"} sin enviar desde hace más de 24 h. Conéctate a internet.
        </div>
      )}
      {!app.canCapture && app.captureBlockedReason && (
        <div className="bg-warn-soft px-4 py-2 text-sm text-warn" role="alert">{app.captureBlockedReason}</div>
      )}
      <UpdateBanner />
      {app.error && app.status !== "syncing" && <div className="bg-danger-soft px-4 py-2 text-sm text-danger">{app.error}</div>}
    </header>
  );
}

const DISMISS_KEY = "update.dismissed";
const readDismissed = () => { try { return localStorage.getItem(DISMISS_KEY); } catch { return null; } };

/** «Nueva versión X disponible · Actualizar» (se puede ocultar; vuelve con la siguiente versión). */
function UpdateBanner() {
  const app = useApp();
  const latest = app.update.latest;
  const [dismissed, setDismissed] = useState(readDismissed);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!app.updateAvailable || app.updateRequired || !latest || dismissed === latest) return null;
  const dismiss = () => { try { localStorage.setItem(DISMISS_KEY, latest); } catch { /* sin almacenamiento */ } setDismissed(latest); };
  const go = async () => { setBusy(true); setErr(null); try { await app.startUpdate(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <div className="flex items-center gap-2 bg-info-soft px-4 py-1 text-sm text-info" role="status">
      <p className="min-w-0 flex-1">Nueva versión {latest} disponible{err && <span className="block text-danger">{err}</span>}</p>
      <Button variant="ghost" className="shrink-0 px-3 text-sm" busy={busy} onClick={() => void go()}>Actualizar</Button>
      <button type="button" aria-label="Ocultar aviso de actualización" className="min-h-11 min-w-11 shrink-0 text-lg" onClick={dismiss}>×</button>
    </div>
  );
}

/** Pantalla completa «Actualización obligatoria»: primero se envían los pendientes, luego se instala. */
function UpdateRequiredScreen({ onConsult }: { onConsult: () => void }) {
  const app = useApp();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = app.pendingCount;
  const go = async () => { setBusy(true); setErr(null); try { await app.startUpdate(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return (
    <AuthScreen title="Actualización obligatoria" subtitle={`Tienes la versión ${app.update.current}; se requiere ${app.update.latest ?? "una más reciente"}.`}>
      <div className="space-y-4">
        {n > 0 ? (
          <>
            <Alert tone="warn">
              Antes de actualizar hay que enviar {n} {n === 1 ? "cambio pendiente" : "cambios pendientes"}.
              {app.status === "offline" ? " Conéctate a internet para enviarlos." : ""}
            </Alert>
            <Button className="w-full" busy={app.status === "syncing"} disabled={app.status === "offline"} onClick={() => void app.syncNow()}>Enviar pendientes</Button>
          </>
        ) : (
          <>
            <Alert tone="ok">Tus cambios ya se enviaron al servidor. Instala la actualización para volver a capturar; tus datos se conservan.</Alert>
            <Button className="w-full" busy={busy} onClick={() => void go()}>Actualizar ahora</Button>
          </>
        )}
        {app.update.notes && <p className="whitespace-pre-line text-sm text-muted">{app.update.notes}</p>}
        {err && <Alert>{err}</Alert>}
        <Button variant="secondary" className="w-full" onClick={onConsult}>Seguir consultando</Button>
      </div>
    </AuthScreen>
  );
}

function AppInfo() {
  const app = useApp();
  const [msg, setMsg] = useState<{ tone: "ok" | "info" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true); setMsg(null);
    try {
      const u = await app.checkUpdate();
      if (!u.latest) setMsg({ tone: "danger", text: "No se pudo consultar. Revisa tu conexión." });
      else if (!u.available) setMsg({ tone: "ok", text: "Tienes la versión más reciente." });
      else { setMsg({ tone: "info", text: `Versión ${u.latest} disponible. Abriendo descarga…` }); await app.startUpdate(); }
    } catch (e) { setMsg({ tone: "danger", text: errMsg(e) }); } finally { setBusy(false); }
  };
  return (
    <Card title="Aplicación">
      <Facts rows={[["Versión", app.update.current], ["Servidor", API_URL.replace(/^https?:\/\//, "")], ["Pendientes por enviar", String(app.pending)]]} />
      <div className="mt-3 space-y-2">
        <Button variant="secondary" className="w-full" busy={busy} onClick={() => void check()}>Buscar actualización</Button>
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
      </div>
    </Card>
  );
}

const TABS: { id: Tab; icon: ReactNode }[] = [
  { id: "catalog", icon: <path d="M4 5h16M4 12h16M4 19h10" /> },
  { id: "quotes", icon: <><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M10 12h5M10 16h5" /></> },
  { id: "customers", icon: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></> },
  { id: "sales", icon: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6.5 9.5v5M17.5 9.5v5" /></> },
  { id: "inventory", icon: <><path d="M3 8l9-5 9 5v8l-9 5-9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></> },
  { id: "more", icon: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></> },
];

function BottomNav({ tab, tabs, onTab }: { tab: Tab; tabs: Tab[]; onTab: (t: Tab) => void }) {
  const shown = TABS.filter((t) => tabs.includes(t.id));
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-panel" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} aria-label="Principal">
      <ul className="grid" style={{ gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` }}>
        {shown.map((t) => (
          <li key={t.id}>
            <button
              type="button"
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => onTab(t.id)}
              className={`flex min-h-14 w-full flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium leading-tight ${tab === t.id ? "text-brand" : "text-muted"}`}
            >
              <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>{t.icon}</svg>
              <span className="max-w-full truncate">{TAB_LABEL[t.id]}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function More({ onOpenIssue, onInventory, showInventory }: { onOpenIssue: (i: SyncIssue) => void; onInventory: () => void; showInventory: boolean }) {
  const app = useApp();
  const [ask, setAsk] = useState(false);
  return (
    <div className="space-y-3">
      <Card title="Usuario">
        <Facts rows={[["Nombre", app.user?.name], ["Correo", app.user?.email], ["Rol", app.user?.roleName]]} />
      </Card>
      <IssuesCard onOpen={onOpenIssue} />
      {showInventory && <Button variant="secondary" className="w-full" onClick={onInventory}>Inventario</Button>}
      <AppInfo />
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
  const app = useApp();
  const tabs = navTabs(app.can);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const [view, setView] = useState<View>({ tab: "catalog" });
  const [consulting, setConsulting] = useState(false);

  // Botón «atrás» de Android: cierra el detalle antes de salir.
  useEffect(() => {
    let remove: (() => void) | undefined;
    let alive = true;
    void import("@capacitor/app").then(({ App }) => App.addListener("backButton", ({ canGoBack }) => {
      setView((v) => {
        const p = parentOf(v, tabsRef.current);
        if (p) return p;
        if (v.tab !== "catalog") return { tab: "catalog" };
        if (!canGoBack) void App.minimizeApp();
        return v;
      });
    })).then((h) => { if (alive) remove = () => void h.remove(); else void h.remove(); }).catch(() => {});
    return () => { alive = false; remove?.(); };
  }, []);

  useEffect(() => { window.scrollTo(0, 0); }, [view]);

  const backTo = parentOf(view, tabs);
  const backLabel = view.edit?.quoteId ? "Cotización" : view.customerForm?.id ? "Cliente" : backTo ? TAB_LABEL[backTo.tab] : "";
  const back = backTo && (
    <button type="button" onClick={() => setView(backTo)} className="-ml-2 mb-2 inline-flex min-h-11 items-center gap-1 px-2 font-medium text-accent-fg">
      <span aria-hidden>‹</span> {backLabel}
    </button>
  );
  const openQuote = (id: string) => setView({ tab: "quotes", detail: id });
  const openSale = (id: string, notice?: string) => setView({ tab: "sales", detail: id, notice });
  const openCustomer = (id: string, notice?: string) => setView({ tab: "customers", detail: id, notice });
  const openIssue = (i: SyncIssue) => {
    if (i.entity === "Quote") openQuote(i.id);
    else if (i.entity === "Customer") openCustomer(i.id);
    else if (i.entity === "Sale") openSale(i.id);
    else if (i.entity === "Payment" && i.parentId) openSale(i.parentId);
    else setView({ tab: "inventory" });
  };

  if (app.updateRequired && !consulting) return <UpdateRequiredScreen onConsult={() => setConsulting(true)} />;

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
          <QuoteDetail key={view.detail} id={view.detail} notice={view.notice} onEdit={(id) => setView({ tab: "quotes", edit: { quoteId: id } })} onOpenSale={openSale} />
        ) : (
          <QuoteList onOpen={openQuote} onNew={() => setView({ tab: "quotes", edit: {} })} />
        ))}
        {view.tab === "customers" && (view.customerForm ? (
          <CustomerForm id={view.customerForm.id} onSaved={openCustomer} onCancel={() => backTo && setView(backTo)} />
        ) : view.detail ? (
          <CustomerDetail key={view.detail} id={view.detail} notice={view.notice} onOpenQuote={openQuote} onOpenSale={openSale}
            onNewQuote={(customerId) => setView({ tab: "quotes", edit: { customerId } })} onEdit={(id) => setView({ tab: "customers", customerForm: { id } })} />
        ) : <CustomerList onOpen={(id) => openCustomer(id)} onNew={() => setView({ tab: "customers", customerForm: {} })} />)}
        {view.tab === "sales" && (view.detail
          ? <SaleDetail key={view.detail} id={view.detail} notice={view.notice} onOpenQuote={openQuote} onDismissed={() => setView({ tab: "sales" })} />
          : <SaleList onOpen={(id) => openSale(id)} />)}
        {view.tab === "inventory" && <InventoryScreen />}
        {view.tab === "more" && <More onOpenIssue={openIssue} showInventory={!tabs.includes("inventory") && app.can("inventory.read")} onInventory={() => setView({ tab: "inventory" })} />}
      </main>
      <BottomNav tab={view.tab} tabs={tabs} onTab={(t) => setView({ tab: t })} />
    </div>
  );
}
