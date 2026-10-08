"use client";

import { useContext } from "react";
import { cn } from "@/lib/utils";
import { FormErrorsContext } from "./form-context";

function FieldError({ id, error }: { id: string; error?: string[] }) {
  return error ? <p id={id} className="mt-1 text-xs text-danger">{error[0]}</p> : null;
}

export function Field({
  label, name, error: errorProp, hint, className, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string[]; hint?: string }) {
  const fromForm = useContext(FormErrorsContext)?.[name];
  const error = errorProp ?? fromForm;
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <input id={name} name={name} className="input" aria-invalid={!!error} aria-describedby={error ? errId : undefined} {...props} />
      {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <FieldError id={errId} error={error} />
    </div>
  );
}

export function SelectField({
  label, name, options, error: errorProp, className, ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; name: string; options: { value: string; label: string }[]; error?: string[] }) {
  const fromForm = useContext(FormErrorsContext)?.[name];
  const error = errorProp ?? fromForm;
  const errId = `${name}-error`;
  return (
    <div className={className}>
      <label htmlFor={name} className="label">{label}</label>
      <select id={name} name={name} className={cn("input")} aria-invalid={!!error} aria-describedby={error ? errId : undefined} {...props}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <FieldError id={errId} error={error} />
    </div>
  );
}
