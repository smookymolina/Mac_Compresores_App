"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Field } from "@/components/ui";

interface Result { ok: boolean; error?: string; message?: string; fieldErrors?: Record<string, string[]> }

/** Envía el formulario multipart a un route handler (una server action no admite archivos tan grandes). */
function useUpload(endpoint: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch(endpoint, { method: "POST", body: new FormData(form) });
      const body = (await r.json().catch(() => ({ ok: false, error: r.status === 413 ? "El archivo es demasiado grande." : "Respuesta inválida del servidor." }))) as Result;
      setRes(body);
      if (body.ok) { form.reset(); router.refresh(); }
    } catch {
      setRes({ ok: false, error: "No se pudo contactar al servidor." });
    } finally {
      setBusy(false);
    }
  }
  return { busy, res, onSubmit };
}

function SubmitRow({ busy, res, label }: { busy: boolean; res: Result | null; label: string }) {
  return (
    <div className="sm:col-span-2">
      <Button disabled={busy} aria-busy={busy} className="w-full sm:w-auto">{busy ? "Subiendo…" : label}</Button>
      {res && !res.ok && <p role="alert" className="mt-2 text-sm text-danger">{res.error}</p>}
      {res?.ok && <p role="status" className="mt-2 text-sm text-ok">{res.message}</p>}
    </div>
  );
}

const SEMVER_PATTERN = "\\d+\\.\\d+\\.\\d+(-[0-9A-Za-z.-]+)?";
const FILE_CLASS = "input max-w-md file:mr-3 file:rounded file:border-0 file:bg-panel-2 file:px-3 file:py-1.5 file:text-sm";

/** Sube el APK a POST /api/app/releases. Con un IPA Ad Hoc publicado, el enlace iOS es /app y no se captura. */
export function ReleaseForm({ latest, minimum, iosUrl, iosAdHoc = false }: { latest: string; minimum: string; iosUrl: string; iosAdHoc?: boolean }) {
  const { busy, res, onSubmit } = useUpload("/api/app/releases");
  const fe = res?.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="apk-file" className="label">Archivo APK</label>
        <input id="apk-file" type="file" name="file" accept=".apk,application/vnd.android.package-archive" required
          className={FILE_CLASS} />
        <p className="mt-1 text-xs text-muted">APK firmado con la llave de MAC, máximo 150 MB.</p>
      </div>
      <Field label="Versión" name="version" required placeholder={latest} pattern={SEMVER_PATTERN} inputMode="decimal" error={fe?.version} hint="Formato 1.2.3; debe coincidir con la del APK." />
      <Field label="Versión mínima" name="minimum" required defaultValue={minimum} pattern={SEMVER_PATTERN} inputMode="decimal" error={fe?.minimum} hint="Los teléfonos por debajo deben actualizar para seguir capturando." />
      <div className="sm:col-span-2">
        <label htmlFor="apk-notes" className="label">Notas del cambio</label>
        <textarea id="apk-notes" name="notes" rows={3} maxLength={2000} className="input" />
        {fe?.notes && <p className="mt-1 text-xs text-danger">{fe.notes[0]}</p>}
      </div>
      {!iosAdHoc && (
        <Field className="sm:col-span-2" label="Enlace iOS (opcional)" name="iosUrl" type="url" defaultValue={iosUrl} placeholder="https://…" error={fe?.iosUrl} hint="Por ejemplo, invitación de TestFlight. Si publicas un IPA Ad Hoc, iOS se instala desde /app." />
      )}
      <SubmitRow busy={busy} res={res} label="Publicar versión" />
    </form>
  );
}

/** Sube el IPA Ad Hoc a POST /api/app/releases/ios. */
export function IosReleaseForm({ latest }: { latest: string }) {
  const { busy, res, onSubmit } = useUpload("/api/app/releases/ios");
  const fe = res?.fieldErrors;
  return (
    <form onSubmit={onSubmit} className="grid gap-3 p-4 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <label htmlFor="ipa-file" className="label">Archivo IPA</label>
        <input id="ipa-file" type="file" name="file" accept=".ipa,application/octet-stream" required className={FILE_CLASS} />
        <p className="mt-1 text-xs text-muted">Build Ad Hoc firmado con el perfil de MAC (solo instala en los iPhone registrados), máximo 200 MB.</p>
      </div>
      <Field label="Versión" name="version" required placeholder={latest} pattern={SEMVER_PATTERN} inputMode="decimal" error={fe?.version} hint="Formato 1.2.3; debe coincidir con la del IPA." />
      <SubmitRow busy={busy} res={res} label="Publicar IPA" />
    </form>
  );
}
