"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, ErrorState, TableSkeleton, TableWrap } from "./data";

export interface DataColumn {
  id: string;
  header: string;
  align?: "right";
  sortable?: boolean;
  /** Clases extra para las celdas de la columna (p. ej. "whitespace-nowrap"). */
  cellClass?: string;
}

/** `cells` llegan ya renderizadas desde el servidor; `sort` aporta el valor comparable de cada columna. */
export interface DataRow {
  id: string;
  cells: React.ReactNode[];
  sort?: (string | number | null)[];
}

const collator = new Intl.Collator("es", { numeric: true, sensitivity: "base" });

/**
 * Tabla de datos: cabecera fija, orden por columna (sobre las filas cargadas), y estados
 * de carga / error / vacío. No cambia consultas ni paginación: solo reordena lo recibido.
 */
export function DataTable({
  columns, rows, empty, error, loading, caption,
}: {
  columns: DataColumn[];
  rows: DataRow[];
  empty?: React.ReactNode;
  error?: string;
  loading?: boolean;
  caption?: string;
}) {
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const m = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a.sort?.[sort.col] ?? null;
      const y = b.sort?.[sort.col] ?? null;
      if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1; // vacíos siempre al final
      if (typeof x === "number" && typeof y === "number") return (x - y) * m;
      return collator.compare(String(x), String(y)) * m;
    });
  }, [rows, sort]);

  if (loading) return <TableSkeleton cols={columns.length} />;
  if (error) return <ErrorState>{error}</ErrorState>;
  if (rows.length === 0) return <>{empty ?? <EmptyState title="Sin resultados" />}</>;

  const cycle = (col: number) =>
    setSort((s) => (s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));

  return (
    <TableWrap>
      <table className="table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((c, i) => {
              const dir = sort?.col === i ? sort.dir : null;
              const Icon = dir === null ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
              return (
                <th
                  key={c.id}
                  scope="col"
                  className={c.align === "right" ? "num" : undefined}
                  aria-sort={dir ? (dir === "asc" ? "ascending" : "descending") : c.sortable ? "none" : undefined}
                >
                  {c.sortable ? (
                    <button type="button" onClick={() => cycle(i)}>
                      {c.header}
                      <Icon size={12} strokeWidth={1.75} aria-hidden className={cn(dir === null && "opacity-50")} />
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id}>
              {r.cells.map((cell, i) => (
                <td key={columns[i].id} className={cn(columns[i].align === "right" && "num", columns[i].cellClass)}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
