"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";
import { Button, useToast } from "@/components/ui";
import { FormErrorsContext } from "@/components/ui/form-context";
import { cn } from "@/lib/utils";


/** Formulario ligado a una server action; muestra errores y resetea en éxito si se pide. */
export function ActionForm<T>({
  action, children, submitLabel = "Guardar", resetOnSuccess, className, confirmText, variant, size,
}: {
  action: (prev: ActionResult<T> | null, fd: FormData) => Promise<ActionResult<T>>;
  children?: React.ReactNode;
  submitLabel?: string;
  resetOnSuccess?: boolean;
  className?: string;
  confirmText?: string;
  variant?: "primary" | "secondary" | "danger";
  /** "sm" para acciones dentro de filas o listas. */
  size?: "md" | "sm";
}) {
  const [state, formAction, pending] = useActionState<ActionResult<T> | null, FormData>(action, null);
  const [, startTransition] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  const { push } = useToast();
  // Envío manual: evita el reseteo automático de React 19 que borraría lo capturado si hay error.
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };
  useEffect(() => {
    if (!state?.ok) return;
    if (resetOnSuccess) ref.current?.reset();
    push(state.message ?? "Guardado.", "success");
  }, [state, resetOnSuccess, push]);
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;

  return (
    <form ref={ref} onSubmit={onSubmit} className={cn("space-y-3", className)}>
      <FormErrorsContext.Provider value={fieldErrors}>{children}</FormErrorsContext.Provider>
      {confirmText && (
        <label className="flex items-start gap-2 text-xs text-ink-soft">
          <input type="checkbox" required className="mt-0.5 size-4 shrink-0" /> {confirmText}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending} aria-busy={pending || undefined} variant={variant} size={size}>
          {pending ? "Procesando…" : submitLabel}
        </Button>
        {state && !state.ok && <p role="status" className="text-sm text-danger">{state.error}</p>}
      </div>
    </form>
  );
}
