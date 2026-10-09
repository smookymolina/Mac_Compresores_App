"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Home } from "lucide-react";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  dashboard: "Dashboard", cotizaciones: "Cotizaciones", ventas: "Ventas", clientes: "Clientes",
  productos: "Productos y precios", inventario: "Inventario", comisiones: "Comisiones",
  usuarios: "Usuarios", auditoria: "Auditoría", cobranza: "Cobranza", reportes: "Reportes", avisos: "Avisos", nueva: "Nueva", nuevo: "Nuevo", editar: "Editar", importar: "Importar CSV",
};

/** Ruta derivada de la URL; los identificadores (UUID) se muestran como "Detalle". */
export function Breadcrumb() {
  const segs = usePathname().split("/").filter(Boolean);
  if (segs.length === 0) return null;
  return (
    <nav aria-label="Ruta de navegación" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-1 text-sm">
        <li className="flex items-center gap-1 max-md:hidden">
          <Link href="/dashboard" aria-label="Inicio" className="grid size-6 place-items-center rounded text-muted hover:text-ink">
            <Home size={15} strokeWidth={1.75} aria-hidden />
          </Link>
          <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />
        </li>
        {segs.map((s, i) => {
          const last = i === segs.length - 1;
          const href = "/" + segs.slice(0, i + 1).join("/");
          return (
            <li key={href} className={cn("flex min-w-0 items-center gap-1", !last && "max-md:hidden")}>
              {last ? (
                <span aria-current="page" className="truncate font-medium text-ink">{LABELS[s] ?? "Detalle"}</span>
              ) : (
                <>
                  <Link href={href} className="truncate text-ink-soft hover:text-ink hover:underline">{LABELS[s] ?? "Detalle"}</Link>
                  <ChevronRight size={14} strokeWidth={1.75} aria-hidden className="shrink-0 text-muted" />
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
