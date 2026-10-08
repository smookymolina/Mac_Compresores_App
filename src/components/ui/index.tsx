// Primitivas al estilo shadcn/ui (código propio, sin runtime adicional).
import Link from "next/link";
import { cn } from "@/lib/utils";

type BtnVariant = "primary" | "secondary" | "danger" | "ghost";
const btn: Record<BtnVariant, string> = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-line bg-white text-ink hover:bg-slate-50",
  danger: "bg-danger text-white hover:bg-red-800",
  ghost: "text-ink-soft hover:bg-slate-100",
};
const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-brand";

export function Button({
  variant = "primary",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant }) {
  return <button className={cn(btnBase, btn[variant], className)} {...props} />;
}

export function LinkButton({
  variant = "primary",
  className,
  ...props
}: React.ComponentProps<typeof Link> & { variant?: BtnVariant }) {
  return <Link className={cn(btnBase, btn[variant], className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 rounded-lg border border-line bg-white shadow-sm", className)} {...props} />;
}

export function CardHeader({ title, actions }: { title: string; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <h2 className="text-sm font-semibold">{title}</h2>
      {actions}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle && <p className="text-sm text-ink-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "blue" | "green" | "red" | "amber";
const tones: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  blue: "bg-blue-50 text-brand-dark",
  green: "bg-green-50 text-ok",
  red: "bg-red-50 text-danger",
  amber: "bg-amber-50 text-warn",
};
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Field({ label, name, error, className, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string[] }) {
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} name={name} className="input" aria-invalid={!!error} {...props} />
      {error && <p className="mt-1 text-xs text-danger">{error[0]}</p>}
    </div>
  );
}

export function SelectField({
  label, name, options, error, className, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; options: { value: string; label: string }[]; error?: string[] }) {
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <select id={name} name={name} className="input" {...props}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1 text-xs text-danger">{error[0]}</p>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="px-4 py-12 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-ink-soft">{children}</div>}
    </div>
  );
}

export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Stat({ label, value, hint, tone }: { label: string; value: React.ReactNode; hint?: string; tone?: "red" }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-soft">{label}</p>
      <p className={cn("mt-1 text-2xl font-bold tabular-nums", tone === "red" && "text-danger")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-soft">{hint}</p>}
    </Card>
  );
}
