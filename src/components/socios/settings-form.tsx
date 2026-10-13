"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field, useToast } from "@/components/ui";
import { setGlobalPartnerSettingsAction } from "@/modules/partners/admin-actions";
import { pctLabel } from "./pct";

type Errors = Record<string, string[] | undefined>;

function pctError(v: string): string | null {
  const t = v.trim();
  if (!t) return "Escribe un porcentaje entre 0 y 60.";
  if (!/^\d+(\.\d+)?$/.test(t) || Number(t) > 60) return "Escribe un porcentaje entre 0 y 60.";
  return /\.\d{3,}$/.test(t) ? "Usa hasta 2 decimales, por ejemplo 12.5." : null;
}
function quotaError(v: string): string | null {
  return /^\d+$/.test(v.trim()) && Number(v) >= 1 && Number(v) <= 1000 ? null : "Escribe un número entero mayor que 0 (hasta 1000).";
}

export function SettingsForm({ discountPct, dailyQuota, onGlobal, total }: { discountPct: string; dailyQuota: number; onGlobal: number; total: number }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [pct, setPct] = useState(discountPct);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");

  const sample = !pctError(pct) ? (1000 * (1 - Number(pct) / 100)).toLocaleString("es-MX", { style: "currency", currency: "MXN" }) : null; // solo presentación

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    const fd = new FormData(e.currentTarget);
    const eP = pctError(String(fd.get("discountPct") ?? ""));
    const eQ = quotaError(String(fd.get("dailyQuota") ?? ""));
    setErrors({ discountPct: eP ? [eP] : undefined, dailyQuota: eQ ? [eQ] : undefined });
    if (eP || eQ) {
      (e.currentTarget.elements.namedItem(eP ? "discountPct" : "dailyQuota") as HTMLElement | null)?.focus();
      return;
    }
    start(async () => {
      const r = await setGlobalPartnerSettingsAction(null, fd);
      if (r.ok) {
        push(`Descuento global actualizado a ${pctLabel(pct)}.`, "success");
        router.refresh();
      } else {
        if (r.fieldErrors) setErrors(r.fieldErrors);
        setFormError(r.fieldErrors ? r.error : "No pudimos guardar los ajustes. Inténtalo de nuevo.");
      }
    });
  };

  return (
    <form noValidate onSubmit={submit} className="grid gap-4 p-4 md:grid-cols-2">
      <Field
        label="Descuento global (%)" name="discountPct" inputMode="decimal" value={pct} required error={errors.discountPct}
        onChange={(e) => setPct(e.target.value)} onBlur={(e) => { const m = pctError(e.target.value); setErrors((x) => ({ ...x, discountPct: m ? [m] : undefined })); }}
        hint="Aplica a los socios sin descuento propio. Entre 0 y 60, hasta 2 decimales."
      />
      <Field
        label="Cuota diaria de búsquedas" name="dailyQuota" inputMode="numeric" defaultValue={String(dailyQuota)} required error={errors.dailyQuota}
        onBlur={(e) => { const m = quotaError(e.target.value); setErrors((x) => ({ ...x, dailyQuota: m ? [m] : undefined })); }}
        hint="Aplica a los socios sin cuota propia."
      />
      <div className="space-y-1 text-sm text-ink-soft md:col-span-2" aria-live="polite">
        <p>{onGlobal} de {total} socios usan el descuento global.</p>
        {sample && <p>Un producto de $1,000.00 se muestra a {sample} (con {pctLabel(pct)}).</p>}
      </div>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" className="tap" disabled={pending} aria-busy={pending || undefined}>{pending ? "Procesando…" : "Guardar ajustes"}</Button>
        {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
      </div>
    </form>
  );
}
