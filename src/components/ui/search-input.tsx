"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

/** Búsqueda en vivo: actualiza la URL (con los demás filtros del formulario) mientras se escribe. */
export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const ref = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const schedule = (el: HTMLInputElement) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const qs = new URLSearchParams();
      const entries = el.form ? [...new FormData(el.form)] : [[props.name ?? "q", el.value]];
      for (const [k, v] of entries) if (typeof v === "string" && v.trim() && k !== "page") qs.set(k, v.trim());
      startTransition(() => router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false }));
    }, 300);
  };

  useEffect(() => {
    // Si se escribió antes de que la página terminara de cargar (hidratación), busca con lo ya escrito.
    const el = ref.current;
    if (el && el.value !== String(props.defaultValue ?? "")) schedule(el);
    // Los demás filtros del formulario (listas, casillas, fechas) también se aplican al cambiar, sin "Filtrar".
    const form = el?.form;
    const onChange = (e: Event) => { if (el && e.target !== el) schedule(el); };
    form?.addEventListener("change", onChange);
    return () => { clearTimeout(timer.current); form?.removeEventListener("change", onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span className="search">
      {pending ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden /> : <Search size={16} strokeWidth={1.75} aria-hidden />}
      <input
        type="search"
        {...props}
        className="input"
        ref={ref}
        onChange={(e) => {
          props.onChange?.(e);
          schedule(e.currentTarget);
        }}
      />
    </span>
  );
}
