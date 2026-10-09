"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { toCsv } from "@/lib/csv";

interface Result {
  ok: boolean;
  error?: string;
  created?: number;
  updated?: number;
  unchanged?: number;
  errorCount?: number;
  errors?: { row: number; message: string }[];
  byType?: Record<string, number>;
}

function downloadErrors(errors: { row: number; message: string }[]) {
  const csv = toCsv(["Fila", "Error"], errors.map((e) => [e.row, e.message]));
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "errores-importacion.csv" });
  a.click();
  URL.revokeObjectURL(url);
}

export function ImportForm() {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/productos/importar", { method: "POST", body: new FormData(e.currentTarget) });
      setRes(await r.json());
    } catch {
      setRes({ ok: false, error: "No se pudo contactar al servidor." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label htmlFor="file" className="label">Archivo CSV</label>
        <input id="file" type="file" name="file" accept=".csv,text/csv" required className="input max-w-md" />
      </div>
      <Button disabled={busy}>{busy ? "Importando… (listas grandes tardan)" : "Importar"}</Button>
      {res && !res.ok && <p role="alert" className="text-sm text-danger">{res.error}</p>}
      {res?.ok && (
        <div>
          <p className="text-ok">
            Creados: {res.created} · Actualizados: {res.updated} · Sin cambios: {res.unchanged} · Filas con error: {res.errorCount}
          </p>
          {!!res.errors?.length && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
                {Object.entries(res.byType ?? {}).map(([k, n]) => <span key={k} className="text-ink-soft">{k}: <b>{n.toLocaleString("es-MX")}</b></span>)}
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => downloadErrors(res.errors!)}>Descargar errores (CSV)</button>
              </div>
              <p className="mt-1 text-xs text-muted">Corrige esas filas en el archivo original (SKU repetido o «Type» no válido) y vuelve a importarlo: lo ya importado no se duplica.</p>
              <ul className="mt-2 max-h-64 overflow-auto rounded border border-line p-2 text-xs">
                {res.errors.slice(0, 200).map((er, i) => <li key={i}>Fila {er.row}: {er.message}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </form>
  );
}
