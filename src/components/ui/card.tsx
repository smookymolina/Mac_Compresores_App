import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-lg border border-line bg-panel", className)} {...props} />;
}

export function CardHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/**
 * Cabecera de vista: banda de documento a todo el ancho con título, metadatos clave-valor y una acción
 * primaria. En móvil las acciones pasan a una barra inferior fija.
 */
export function PageHeader({
  title, subtitle, meta, actions,
}: {
  title: string; subtitle?: string; meta?: { label: string; value: React.ReactNode }[]; actions?: React.ReactNode;
}) {
  return (
    <div className="page-head -mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:-mt-6">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink md:text-[1.375rem]">{title}</h1>
        {subtitle && <p className="mt-1 max-w-prose text-sm text-ink-soft">{subtitle}</p>}
        {meta && meta.length > 0 && (
          <dl className="page-meta">
            {meta.map((m) => <div key={m.label}><dt>{m.label}</dt><dd className="truncate">{m.value}</dd></div>)}
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
  label, value, hint, tone, icon: Icon,
}: {
  label: string; value: React.ReactNode; hint?: string; tone?: "red";
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean; className?: string }>;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-ink-soft">
        {Icon && <Icon size={15} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />}
        <p className="truncate text-sm">{label}</p>
      </div>
      <p className={cn("kpi-value mt-2", tone === "red" ? "text-danger" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
