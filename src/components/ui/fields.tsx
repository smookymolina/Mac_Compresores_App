"use client";

import { useContext, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
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

/** Contraseña con botón para mostrar u ocultar lo escrito (no cambia `name`/`id`). */
export function PasswordField({
  label, name, error: errorProp, className, ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; name: string; error?: string[] }) {
  const [error, clear] = useFieldError(name, errorProp);
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <div className="relative">
        <input
          id={name} name={name} type={visible ? "text" : "password"} className="input pr-11"
          aria-invalid={!!error} aria-describedby={error ? errId : undefined}
          {...props} onInput={(e) => { clear(); props.onInput?.(e); }}
          onKeyUp={(e) => setCaps(e.getModifierState("CapsLock"))} onBlur={() => setCaps(false)}
        />
        {/* Nombre accesible sin la palabra de la etiqueta: getByLabel(label) sigue apuntando solo al campo. */}
        <button
          type="button" aria-label={visible ? "Ocultar lo escrito" : "Mostrar lo escrito"} aria-pressed={visible} aria-controls={name}
          data-tip={visible ? "Ocultar" : "Mostrar"} onClick={() => setVisible((v) => !v)}
          className="reveal-btn"
        >
          <Eye size={16} strokeWidth={1.75} aria-hidden className="reveal-icon" data-on={!visible} />
          <EyeOff size={16} strokeWidth={1.75} aria-hidden className="reveal-icon" data-on={visible} />
        </button>
      </div>
      {caps && <p aria-live="polite" className="field-hint mt-1 text-xs text-warn">Bloq Mayús está activado.</p>}
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
