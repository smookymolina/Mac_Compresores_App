"use client";

import { useState } from "react";
import { Button } from "@/components/ui";

interface Result {
  ok: boolean;
  error?: string;
  created?: number;
  updated?: number;
  unchanged?: number;
  errorCount?: number;
  errors?: { row: number; message: string }[];
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
            <ul className="mt-2 max-h-64 overflow-auto rounded border border-line p-2 text-xs">
              {res.errors.map((er, i) => <li key={i}>Fila {er.row}: {er.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}
