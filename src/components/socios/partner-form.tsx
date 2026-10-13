"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy } from "lucide-react";
import { Button, Field, useToast } from "@/components/ui";
import { savePartnerAction } from "@/modules/partners/admin-actions";

type Errors = Record<string, string[] | undefined>;
export interface PartnerFormValues { id?: string; name: string; company: string; email: string; discountPct: string; dailyQuota: string }

const RULES: Record<string, (v: string) => string | null> = {
  name: (v) => (v.trim().length < 2 ? "Escribe el nombre del socio." : null),
  company: (v) => (v.trim().length < 2 ? "Escribe la empresa del socio." : null),
  email: (v) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) ? null : "Escribe un correo válido, por ejemplo nombre@empresa.com."),
  discountPct: (v) => {
    const t = v.trim();
    if (!t) return null;
    if (!/^\d+(\.\d+)?$/.test(t) || Number(t) > 60) return "Escribe un porcentaje entre 0 y 60.";
    return /\.\d{3,}$/.test(t) ? "Usa hasta 2 decimales, por ejemplo 12.5." : null;
  },
  dailyQuota: (v) => {
    const t = v.trim();
    if (!t) return null;
    return /^\d+$/.test(t) && Number(t) >= 1 && Number(t) <= 1000 ? null : "Escribe un número entero mayor que 0 (hasta 1000).";
  },
};

/** Alta/edición de socio. Etiquetas visibles, validación al salir del campo y la contraseña temporal se muestra una sola vez. */
export function PartnerForm({ values, globalPct, globalQuota }: { values: PartnerFormValues; globalPct: string; globalQuota: number }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [created, setCreated] = useState<{ id: string; name: string; tempPassword: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  const isNew = !values.id;

  const check = (name: string, v: string) => {
    const msg = RULES[name]?.(v) ?? null;
    setErrors((e) => ({ ...e, [name]: msg ? [msg] : undefined }));
    return msg;
  };
  const onBlur = (e: React.FocusEvent<HTMLInputElement>) => { check(e.target.name, e.target.value); };

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setFormError("");
    const fd = new FormData(e.currentTarget);
    let firstBad = "";
    for (const k of Object.keys(RULES)) if (check(k, String(fd.get(k) ?? "")) && !firstBad) firstBad = k;
    if (firstBad) {
      (ref.current?.elements.namedItem(firstBad) as HTMLElement | null)?.focus();
      return;
    }
    if (values.id) fd.set("id", values.id);
    start(async () => {
      const r = await savePartnerAction(null, fd);
      if (r.ok && r.data) {
        if (r.data.tempPassword) setCreated({ id: r.data.id, name: String(fd.get("name")), tempPassword: r.data.tempPassword });
        else {
          push(`Guardaste los cambios de ${String(fd.get("name"))}.`, "success");
          router.refresh();
        }
      } else if (!r.ok) {
        setErrors((cur) => ({ ...cur, ...(r.fieldErrors ?? {}) }));
        setFormError(r.error);
      }
    });
  };

  if (created)
    return (
      <div className="space-y-3 p-4">
        {/* Solo el aviso es región viva: la contraseña no debe leerse en voz alta sola. */}
        <p role="status" className="text-sm font-medium">{created.name} quedó registrado.</p>
        <p className="portal-warn">Esta contraseña temporal se muestra una sola vez. Compártela por un canal seguro; el socio configurará su 2FA en el primer acceso.</p>
        <p className="mono select-all break-all rounded-md bg-panel-2 p-3 text-base">{created.tempPassword}</p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button" className="btn btn-secondary tap gap-2"
            onClick={async () => { try { await navigator.clipboard.writeText(created.tempPassword); setCopied(true); } catch { /* sin portapapeles: está seleccionable */ } }}
          >
            <Copy size={16} strokeWidth={1.75} aria-hidden /> {copied ? "Copiada" : "Copiar contraseña"}
          </button>
          <Link className="btn btn-primary tap" href={`/socios-admin/${created.id}`}>Ir al socio</Link>
        </div>
      </div>
    );

  return (
    <form ref={ref} noValidate onSubmit={submit} className="grid gap-4 p-4 md:grid-cols-2">
      <Field label="Nombre" name="name" defaultValue={values.name} required autoComplete="off" error={errors.name} onBlur={onBlur} />
      <Field label="Empresa" name="company" defaultValue={values.company} required autoComplete="off" error={errors.company} onBlur={onBlur} />
      <Field label="Correo electrónico" name="email" type="email" defaultValue={values.email} required autoComplete="off" spellCheck={false} error={errors.email} onBlur={onBlur}
        hint={isNew ? "Se genera una contraseña temporal al crear al socio; la verás una sola vez." : undefined} />
      <span className="hidden md:block" aria-hidden />
      <Field label="Descuento propio (%)" name="discountPct" inputMode="decimal" defaultValue={values.discountPct} error={errors.discountPct} onBlur={onBlur}
        hint={`Déjalo vacío para usar el global (${globalPct} %).`} />
      <Field label="Cuota diaria de búsquedas" name="dailyQuota" inputMode="numeric" defaultValue={values.dailyQuota} error={errors.dailyQuota} onBlur={onBlur}
        hint={`Déjalo vacío para usar el valor global (${globalQuota}).`} />
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <Button type="submit" className="tap" disabled={pending} aria-busy={pending || undefined}>
          {pending ? "Procesando…" : isNew ? "Crear socio" : "Guardar cambios"}
        </Button>
        {formError && <p role="alert" className="text-sm text-danger">{formError}</p>}
      </div>
    </form>
  );
}
