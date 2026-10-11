"use client";

import { useEffect, useRef, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2, Search } from "lucide-react";

/** Búsqueda en vivo: actualiza la URL (con los demás filtros del formulario) mientras se escribe. */
export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const router = useRouter();
  const pathname = usePathname();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [pending, startTransition] = useTransition();
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <span className="search">
      {pending ? <Loader2 size={16} strokeWidth={1.75} className="animate-spin" aria-hidden /> : <Search size={16} strokeWidth={1.75} aria-hidden />}
      <input
        type="search"
        {...props}
        className="input"
        onChange={(e) => {
          props.onChange?.(e);
          const form = e.currentTarget.form;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            const qs = new URLSearchParams();
            const entries = form ? [...new FormData(form)] : [[props.name ?? "q", e.target.value]];
            for (const [k, v] of entries) if (typeof v === "string" && v.trim() && k !== "page") qs.set(k, v.trim());
            startTransition(() => router.replace(qs.size ? `${pathname}?${qs}` : pathname, { scroll: false }));
          }, 300);
        }}
      />
    </span>
  );
}
