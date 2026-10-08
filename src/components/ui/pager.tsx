import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** Pie de tabla con página actual, total y enlaces Anterior/Siguiente (estado en la URL). */
export function Pager({ page, pages, total, noun, href }: { page: number; pages: number; total: number; noun: string; href: (n: number) => string }) {
  return (
    <nav aria-label="Paginación" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2.5 text-sm text-ink-soft">
      <span className="tabular-nums">{total.toLocaleString("es-MX")} {noun} · página {page} de {pages}</span>
      <span className="flex gap-2">
        {page > 1 && <Link className="btn btn-secondary btn-sm" href={href(page - 1)}><ChevronLeft size={14} strokeWidth={1.75} aria-hidden /> Anterior</Link>}
        {page < pages && <Link className="btn btn-secondary btn-sm" href={href(page + 1)}>Siguiente <ChevronRight size={14} strokeWidth={1.75} aria-hidden /></Link>}
      </span>
    </nav>
  );
}
