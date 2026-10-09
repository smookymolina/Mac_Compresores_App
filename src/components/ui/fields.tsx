"use client";

import { useContext, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { FormErrorsContext } from "./form-context";

/** Error del servidor para `name`; se oculta en cuanto el usuario corrige el campo (vuelve con el siguiente envío). */
function useFieldError(name: string, errorProp?: string[]) {
  const fromForm = useContext(FormErrorsContext)?.[name];
  const error = errorProp ?? fromForm;
  const [dismissed, setDismissed] = useState<string[] | undefined>();
  const shown = error && error !== dismissed ? error : undefined;
  return [shown, () => { if (shown) setDismissed(error); }] as const;
}

function FieldError({ id, error }: { id: string; error?: string[] }) {
  return error ? <p id={id} className="mt-1 text-xs text-danger">{error[0]}</p> : null;
}

export function Field({
  label, name, error: errorProp, hint, className, icon, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string[]; hint?: string; icon?: React.ReactNode }) {
  const [error, clear] = useFieldError(name, errorProp);
  const errId = `${name}-error`;
  const input = (
    <input
      id={name} name={name} className="input" aria-invalid={!!error} aria-describedby={error ? errId : undefined}
      {...props} onInput={(e) => { clear(); props.onInput?.(e); }}
    />
  );
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      {icon ? <div className="input-wrap has-icon">{input}<span aria-hidden className="input-icon">{icon}</span></div> : input}
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <FieldError id={errId} error={error} />
    </div>
  );
}

/** Contraseña con botón para ver lo escrito y aviso de Bloq Mayús. */
export function PasswordField({
  label, name, error: errorProp, hint, className, icon, ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; name: string; error?: string[]; hint?: string; icon?: React.ReactNode }) {
  const [error, clear] = useFieldError(name, errorProp);
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const errId = `${name}-error`;
  const capsId = `${name}-caps`;
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => setCaps(e.getModifierState?.("CapsLock") ?? false);
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <div className={cn("input-wrap has-action", icon && "has-icon")}>
        <input
          id={name} name={name} type={visible ? "text" : "password"} className="input" aria-invalid={!!error}
          aria-describedby={[error ? errId : "", caps ? capsId : ""].filter(Boolean).join(" ") || undefined}
          {...props} onInput={(e) => { clear(); props.onInput?.(e); }}
          onKeyDown={(e) => { onKey(e); props.onKeyDown?.(e); }} onKeyUp={onKey} onBlur={(e) => { setCaps(false); props.onBlur?.(e); }}
        />
        {icon && <span aria-hidden className="input-icon">{icon}</span>}
        {/* Etiqueta sin la palabra del campo: getByLabel("Contraseña") debe seguir siendo único. */}
        <button
          type="button" className="input-action" aria-pressed={visible} aria-controls={name}
          aria-label={visible ? "Ocultar lo escrito" : "Mostrar lo escrito"} onClick={() => setVisible((v) => !v)}
        >
          <span className={cn("eye", visible && "is-open")}>
            {visible ? <EyeOff size={16} strokeWidth={1.75} aria-hidden /> : <Eye size={16} strokeWidth={1.75} aria-hidden />}
          </span>
        </button>
      </div>
      <p id={capsId} aria-live="polite" className={cn("caps-hint", caps && "is-on")}>{caps ? "Bloq Mayús está activado" : ""}</p>
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <FieldError id={errId} error={error} />
    </div>
  );
}

export function SelectField({
  label, name, options, error: errorProp, className, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; options: { value: string; label: string }[]; error?: string[] }) {
  const [error, clear] = useFieldError(name, errorProp);
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <select
        id={name} name={name} className="input" aria-invalid={!!error} aria-describedby={error ? errId : undefined}
        {...props} onChange={(e) => { clear(); props.onChange?.(e); }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <FieldError id={errId} error={error} />
    </div>
  );
}
