import Link from "next/link";
import { cn } from "@/lib/utils";
import { PageDecor } from "./page-decor";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card min-w-0 rounded-lg border border-line bg-panel", className)} {...props} />;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="card-title text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Cabecera de vista: banda grafito a todo el ancho (mismo lenguaje que las pantallas de acceso: cuadrícula de
 * plano, tubería con aire en circulación) con título, metadatos clave-valor y una acción primaria.
 * En móvil las acciones pasan a una barra inferior fija.
 */
export function PageHeader({
  title, subtitle, meta, actions, eyebrow, gauge,
}: {
  title: string; subtitle?: string; meta?: { label: string; value: React.ReactNode }[]; actions?: React.ReactNode;
  /** Línea breve sobre el título (p. ej. el mes en curso). */
  eyebrow?: string;
  /** Manómetro decorativo (solo vistas de bienvenida). */
  gauge?: boolean;
}) {
  return (
    <div className={cn("page-head -mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:-mt-6", gauge && "page-head-hero")}>
      <PageDecor gauge={gauge} />
      <div className="relative min-w-0">
        {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
        <h1 className="page-title text-xl font-semibold tracking-tight text-ink md:text-[1.375rem]">
          {title.split(" ").map((w, i) => <span key={i} style={{ "--i": i } as React.CSSProperties}>{w} </span>)}
        </h1>
        {subtitle && <p className="page-sub mt-1 max-w-prose text-sm text-ink-soft">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <dl className="page-meta">
            {meta.map((m) => <div key={m.label}><dt>{m.label}</dt><dd className="min-w-0 break-words">{m.value}</dd></div>)}
          </dl>
        )}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Franja de indicadores: contenedor segmentado para `Stat`. */
export function StatGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("kpis", className)}>{children}</div>;
}

/** Indicador (KPI): etiqueta, cifra tabular y nota. Va dentro de `StatGroup`. */
export function Stat({
  label, value, hint, tone, icon: Icon, href,
}: {
  label: string; value: React.ReactNode; hint?: string; tone?: "red";
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean; className?: string }>;
  /** Si se indica, el indicador entero enlaza a la vista con el detalle. */
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center gap-2 text-ink-soft">
        {Icon && <span className="kpi-icon"><Icon size={15} strokeWidth={1.75} aria-hidden className="shrink-0" /></span>}
        <p className="truncate text-sm">{label}</p>
      </div>
      <p className={cn("kpi-value mt-2", tone === "red" ? "text-danger" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </>
  );
  return href ? <Link href={href} className="kpi kpi-link">{body}</Link> : <div className="kpi">{body}</div>;
}
