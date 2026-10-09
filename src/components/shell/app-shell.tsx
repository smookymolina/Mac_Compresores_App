"use client";

import Image from "next/image";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Menu, Moon, PanelLeftClose, PanelLeftOpen, Sun } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { Breadcrumb } from "./breadcrumb";
import { NavLinks, type NavItem } from "./nav-links";
import { CommandPalette } from "./command-palette";
import { NotificationBell } from "./notification-bell";

const STORAGE_KEY = "sidebar";

function initials(name: string) {
  const letters = name.split(/\s+/).map((w) => w.match(/\p{L}/u)?.[0]).filter(Boolean);
  return (letters.length > 1 ? letters[0]! + letters[1]! : (letters[0] ?? "?")).toUpperCase();
}

function ThemeToggle() {
  const toggle = () => {
    const el = document.documentElement;
    const current = el.dataset.theme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    el.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* almacenamiento bloqueado: el tema vale solo para esta carga */ }
  };
  return (
    <button type="button" aria-label="Cambiar tema claro/oscuro" data-tip="Cambiar tema" onClick={toggle} className="btn btn-ghost icon-btn">
      <span className="on-light"><Moon size={18} strokeWidth={1.75} aria-hidden /></span>
      <span className="on-dark"><Sun size={18} strokeWidth={1.75} aria-hidden /></span>
    </button>
  );
}

function UserMenu({ name, roleName, logout }: { name: string; roleName: string; logout: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button} type="button" aria-label="Cuenta" aria-expanded={open} aria-controls={panelId}
        onClick={() => setOpen((o) => !o)} className="btn btn-ghost gap-2 !px-1.5"
      >
        <span aria-hidden className="grid size-7 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-fg">{initials(name)}</span>
        <span className="hidden max-w-40 text-left lg:block">
          <span className="block truncate text-sm font-medium leading-4 text-ink">{name}</span>
          <span className="block truncate text-xs leading-4 text-muted">{roleName}</span>
        </span>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden className="hidden text-muted lg:block" />
      </button>
      {open && (
        <div id={panelId} className="page-enter absolute right-0 top-full z-40 mt-2 w-60 rounded-lg border border-line bg-panel shadow-[var(--elev-pop)]">
          <div className="px-3 py-2.5">
            <p className="truncate text-sm font-medium">{name}</p>
            <p className="text-xs text-muted">{roleName}</p>
          </div>
          <div className="border-t border-line p-1">{logout}</div>
        </div>
      )}
    </div>
  );
}

/** Estructura de la app: sidebar (icon-only en tablet, colapsable en ≥xl), topbar y drawer móvil. */
export function AppShell({
  nav, user, logout, children,
}: {
  nav: NavItem[];
  user: { name: string; roleName: string };
  logout: React.ReactNode;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try { if (localStorage.getItem(STORAGE_KEY) === "collapsed") setCollapsed(true); } catch { /* sin preferencia guardada */ }
  }, []);
  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try { localStorage.setItem(STORAGE_KEY, c ? "expanded" : "collapsed"); } catch { /* ignorar */ }
      return !c;
    });
  };

  return (
    <div className="min-h-dvh">
      <a href="#main" className="skip-link">Saltar al contenido</a>

      <aside className={cn("sidebar app-sidebar fixed inset-y-0 left-0 z-30 hidden flex-col border-r border-line md:flex", collapsed ? "md:w-16" : "md:w-16 xl:w-60")}>
        <div aria-hidden className="sidebar-grid" />
        <div className="flex h-14 shrink-0 items-center border-b border-line px-3 md:justify-center xl:justify-start">
          <span className={cn("logo-tile", collapsed ? "hidden" : "hidden xl:inline-flex")}>
            <Image src="/brand/logo-h.png" alt="MAC Compresores" width={118} height={32} priority className="h-8 w-auto" />
          </span>
          <span className={cn("logo-tile", collapsed ? "inline-flex" : "inline-flex xl:hidden")}>
            <Image src="/brand/logo.png" alt="MAC Compresores" width={40} height={40} priority className="size-10" />
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <NavLinks items={nav} mode="sidebar" collapsed={collapsed} />
        </div>
        <div className={cn("sidebar-status border-t border-line px-4 py-2.5", collapsed ? "hidden" : "hidden xl:flex")}>
          <span aria-hidden className="auth-status-dot" /> Sistema en línea
        </div>
        <div className="hidden border-t border-line p-2 xl:block">
          <button
            type="button" onClick={toggleCollapsed} aria-pressed={collapsed}
            aria-label={collapsed ? "Expandir menú lateral" : "Contraer menú lateral"}
            className="btn btn-ghost w-full justify-start gap-3 !px-2.5 text-ink-soft"
          >
            {collapsed ? <PanelLeftOpen size={18} strokeWidth={1.75} aria-hidden /> : <PanelLeftClose size={18} strokeWidth={1.75} aria-hidden />}
            {!collapsed && <span>Contraer</span>}
          </button>
        </div>
      </aside>

      <div className={cn(collapsed ? "md:pl-16" : "md:pl-16 xl:pl-60")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-panel px-4 md:px-6">
          <button type="button" aria-label="Abrir menú" data-tip="Abrir menú" data-tip-start="" aria-haspopup="dialog" aria-expanded={drawer} onClick={() => setDrawer(true)} className="btn btn-ghost icon-btn -ml-2 md:hidden">
            <Menu size={20} strokeWidth={1.75} aria-hidden />
          </button>
          <div className="min-w-0 flex-1"><Breadcrumb /></div>
          <CommandPalette />
          <NotificationBell />
          <ThemeToggle />
          <UserMenu name={user.name} roleName={user.roleName} logout={logout} />
        </header>
        <main id="main" tabIndex={-1} className="app-main p-4 outline-none md:p-6">
          <div className="mx-auto max-w-[96rem]">{children}</div>
        </main>
        <footer className="border-t border-line px-4 py-3 text-xs text-muted md:px-6">
          <div className="mx-auto max-w-[96rem]">MAC Compresores · v{APP_VERSION}</div>
        </footer>
      </div>

      <Dialog open={drawer} onClose={() => setDrawer(false)} title="Menú" side="left" className="sidebar">
        <NavLinks items={nav} mode="drawer" onNavigate={() => setDrawer(false)} />
      </Dialog>
    </div>
  );
}
