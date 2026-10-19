import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";

/** Clase de input/select/textarea (misma que `Field`). */
export const INPUT = "min-h-11 w-full rounded-md border border-[var(--border-input)] bg-panel px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none";
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Ocurrió un error.");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean };

const VARIANT = {
  primary: "bg-brand text-white hover:bg-brand-dark",
  secondary: "border border-line-strong bg-panel text-ink hover:bg-panel-2",
  ghost: "text-accent-fg hover:bg-accent-soft",
  danger: "bg-danger text-white",
};

export function Button({ variant = "primary", busy, className = "", children, disabled, ...rest }: BtnProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-base font-medium transition-colors disabled:opacity-60 ${VARIANT[variant]} ${className}`}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, className = "", ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null }) {
  const id = rest.id ?? rest.name;
  return (
    <label className="block" htmlFor={id}>
      <span className="mb-1 block text-sm font-medium text-ink-soft">{label}</span>
      <input
        id={id}
        {...rest}
        aria-invalid={error ? true : undefined}
        className={`min-h-11 w-full rounded-md border border-[var(--border-input)] bg-panel px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none ${className}`}
      />
      {hint && !error && <span className="mt-1 block text-sm text-muted">{hint}</span>}
      {error && <span className="mt-1 block text-sm text-danger">{error}</span>}
    </label>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return <span aria-hidden className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${small ? "size-4" : "size-6 text-brand"}`} />;
}

export function Loading({ label = "Cargando…" }: { label?: string }) {
  return <div className="flex items-center justify-center gap-3 p-8 text-muted" role="status"><Spinner />{label}</div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="p-8 text-center">
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Alert({ tone = "danger", children }: { tone?: "danger" | "warn" | "ok" | "info"; children: ReactNode }) {
  const t = { danger: "bg-danger-soft text-danger", warn: "bg-warn-soft text-warn", ok: "bg-ok-soft text-ok", info: "bg-accent-soft text-accent-fg" }[tone];
  return <div role={tone === "danger" ? "alert" : "status"} className={`rounded-md p-3 text-sm ${t}`}>{children}</div>;
}

/** Pantalla centrada para el flujo de acceso (sin barra ni navegación). */
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-4 py-8">
      <div className="mb-6">
        <p className="text-sm font-semibold uppercase tracking-wide text-brand">MAC Campo</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <div className="mt-2 text-muted">{subtitle}</div>}
      </div>
      <div className="rounded-lg border border-line bg-panel p-4 shadow-sm">{children}</div>
    </main>
  );
}

export function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-panel shadow-sm ${className}`}>
      {title && <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-ink">{title}</h2>}
      <div className="p-4">{children}</div>
    </section>
  );
}

/** Lista de pares etiqueta/valor; omite los vacíos. */
export function Facts({ rows }: { rows: [string, ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <dl className="grid grid-cols-[minmax(0,40%)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "danger" | "info"; children: ReactNode }) {
  const t = { neutral: "bg-panel-2 text-ink-soft border border-line", ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", danger: "bg-danger-soft text-danger", info: "bg-accent-soft text-accent-fg" }[tone];
  return <span className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium ${t}`}>{children}</span>;
}

export function SearchBox({ value, onChange, placeholder, label }: { value: string; onChange: (v: string) => void; placeholder: string; label: string }) {
  return (
    <input
      type="search"
      inputMode="search"
      enterKeyHint="search"
      autoComplete="off"
      aria-label={label}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="min-h-11 w-full rounded-md border border-[var(--border-input)] bg-panel px-3 text-base text-ink placeholder:text-muted focus:border-brand focus:outline-none"
    />
  );
}

/** Diálogo de confirmación modal. */
export function Confirm({ open, title, body, confirmLabel, onConfirm, onCancel, tone = "danger" }: { open: boolean; title: string; body: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void; tone?: "danger" | "primary" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onCancel(); }} className="m-auto w-[min(92vw,24rem)] rounded-lg border border-line bg-panel p-0 text-ink shadow-[var(--elev-pop)] backdrop:bg-black/40">
      <div className="p-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="mt-2 text-sm text-muted">{body}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
          <Button variant={tone} onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}

export function useDebounced<T>(value: T, ms = 200): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Carga asíncrona con estados; `deps` vuelve a cargar. Ignora respuestas viejas. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; loading: boolean; error: string | null; reload: () => void } {
  const [st, setSt] = useState<{ data: T | undefined; loading: boolean; error: string | null }>({ data: undefined, loading: true, error: null });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    fn().then(
      (data) => { if (alive) setSt({ data, loading: false, error: null }); },
      (e: unknown) => { if (alive) setSt((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "No se pudo leer la información." })); },
    );
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n]);
  return { ...st, reload: () => setN((x) => x + 1) };
}

/** Preferencia local de huella (por dispositivo). */
export const bioPref = {
  get: () => { try { return localStorage.getItem("mac.bio") === "1"; } catch { return false; } },
  set: (on: boolean) => { try { if (on) localStorage.setItem("mac.bio", "1"); else localStorage.removeItem("mac.bio"); } catch { /* sin almacenamiento */ } },
};
