"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field } from "@/components/ui";

interface Result { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> }

/** Sube el APK a POST /api/app/releases (route handler: una server action no admite 150 MB). */
export function ReleaseForm({ latest, minimum, iosUrl }: { latest: string; minimum: string; iosUrl: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/app/releases", { method: "POST", body: new FormData(form) });
      const body = (await r.json().catch(() => ({ ok: false, error: r.status === 413 ? "El archivo es demasiado grande." : "Respuesta inválida del servidor." }))) as Result;
      setRes(body);
      if (body.ok) { form.reset(); router.refresh(); }
    } catch {
      setRes({ ok: false, error: "No se pudo contactar al servidor." });
    } finally {
      setBusy(false);
    }
  }

  const fe = res?.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="apk-file" className="label">Archivo APK</label>
        <input id="apk-file" type="file" name="file" accept=".apk,application/vnd.android.package-archive" required
          className="input max-w-md file:mr-3 file:rounded file:border-0 file:bg-panel-2 file:px-3 file:py-1.5 file:text-sm" />
        <p className="mt-1 text-xs text-muted">APK firmado con la llave de MAC, máximo 150 MB.</p>
      </div>
      <Field label="Versión" name="version" required placeholder={latest} pattern="\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?" inputMode="decimal" error={fe?.version} hint="Formato 1.2.3; debe coincidir con la del APK." />
      <Field label="Versión mínima" name="minimum" required defaultValue={minimum} pattern="\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?" inputMode="decimal" error={fe?.minimum} hint="Los teléfonos por debajo deben actualizar para seguir capturando." />
      <div className="sm:col-span-2">
        <label htmlFor="apk-notes" className="label">Notas del cambio</label>
        <textarea id="apk-notes" name="notes" rows={3} maxLength={2000} className="input" />
        {fe?.notes && <p className="mt-1 text-xs text-danger">{fe.notes[0]}</p>}
      </div>
      <Field className="sm:col-span-2" label="Enlace iOS (opcional)" name="iosUrl" type="url" defaultValue={iosUrl} placeholder="https://…" error={fe?.iosUrl} />
      <div className="sm:col-span-2">
        <Button disabled={busy} aria-busy={busy} className="w-full sm:w-auto">{busy ? "Subiendo…" : "Publicar versión"}</Button>
        {res && !res.ok && <p role="alert" className="mt-2 text-sm text-danger">{res.error}</p>}
        {res?.ok && <p role="status" className="mt-2 text-sm text-ok">{res.message}</p>}
      </div>
    </form>
  );
}
