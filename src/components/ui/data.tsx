import { AlertTriangle, Inbox, Search, SearchX } from "lucide-react";
import { LinkButton } from "./button";
import { cn } from "@/lib/utils";

/** Contenedor con scroll controlado: cabecera fija en escritorio y columna fija en móvil (ver .table). */
export function TableWrap({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("table-wrap", className)}>{children}</div>;
}

export function EmptyState({
  title, children, icon: Icon = Inbox, action,
}: {
  title: string; children?: React.ReactNode; action?: React.ReactNode;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean }>;
}) {
  return (
    <div className="empty flex flex-col items-center px-4 py-12 text-center">
      <span className="empty-icon mb-3 grid size-10 place-items-center rounded-lg bg-panel-2 text-muted">
        <Icon size={20} strokeWidth={1.75} aria-hidden />
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="mt-1 max-w-sm text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Vacío por filtros: explica y ofrece volver a la lista completa. */
export function FilteredEmpty({ clearHref }: { clearHref: string }) {
  return (
    <EmptyState icon={SearchX} title="Ningún resultado con estos filtros" action={<LinkButton href={clearHref} variant="secondary">Limpiar filtros</LinkButton>}>
      Prueba con otros términos o quita los filtros.
    </EmptyState>
  );
}

/** Campo de búsqueda de barra de filtros: lupa funcional + nombre accesible. */
export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="search">
      <Search size={16} strokeWidth={1.75} aria-hidden />
      <input type="search" {...props} className="input" />
    </span>
  );
}

export function ErrorState({ title = "No se pudo cargar esta sección.", children, action }: { title?: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return <EmptyState icon={AlertTriangle} title={title} action={action}>{children}</EmptyState>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div aria-busy="true" aria-label="Cargando" className="divide-y divide-line">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex h-10 items-center gap-4 px-3">
          {Array.from({ length: cols }, (_, c) => <Skeleton key={c} className={cn("h-3", c === 0 ? "w-16" : "flex-1")} />)}
        </div>
      ))}
    </div>
  );
}
