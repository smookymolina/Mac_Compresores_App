import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-lg border border-line bg-panel shadow-sm", className)} {...props} />;
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

/** Título de vista + una acción primaria. En móvil las acciones pasan a una barra inferior fija. */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-ink md:text-2xl">{title}</h1>
        {subtitle && <p className="mt-0.5 max-w-prose text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

/** Indicador (KPI): etiqueta, cifra tabular y nota. */
export function Stat({
  label, value, hint, tone, icon: Icon,
}: {
  label: string; value: React.ReactNode; hint?: string; tone?: "red";
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; "aria-hidden"?: boolean; className?: string }>;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-ink-soft">{label}</p>
        {Icon && <Icon size={16} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />}
      </div>
      <p className={cn("mt-2 text-2xl font-semibold tracking-tight tabular-nums", tone === "red" ? "text-danger" : "text-ink")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </Card>
  );
}
