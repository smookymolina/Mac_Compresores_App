"use client";

import { useContext, useState } from "react";
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
  label, name, error: errorProp, hint, className, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string[]; hint?: string }) {
  const [error, clear] = useFieldError(name, errorProp);
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <input
        id={name} name={name} className="input" aria-invalid={!!error} aria-describedby={error ? errId : undefined}
        {...props} onInput={(e) => { clear(); props.onInput?.(e); }}
      />
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
