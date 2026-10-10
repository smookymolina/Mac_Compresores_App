"use client";

import { useActionState, useEffect, useId, useState, useTransition } from "react";
import { BellRing, Clock } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { sendPaymentReminderAction } from "@/modules/payments/actions";
import { Button, Dialog, Field, useToast } from "@/components/ui";
import { FormErrorsContext } from "@/components/ui/form-context";
import { cn, fmtDateTime } from "@/lib/utils";

export interface ReminderDialogProps {
  saleId: string;
  folio: number;
  customer: string;
  /** Saldo y vencimiento ya formateados en el servidor. */
  balance: string;
  due: string;
  replyTo: string;
  to: string;
  message: string;
  lastSentAt: string | null;
  nextAllowedAt: string | null;
  mailConfigured: boolean;
  /** `icon`: botón cuadrado con tooltip (filas de tabla); `button`: botón con texto. */
  variant?: "icon" | "button";
}

/** Botón «Enviar recordatorio» + modal con destinatario, CC y mensaje editables. */
export function ReminderButton(p: ReminderDialogProps) {
  const [open, setOpen] = useState(false);
  const label = `Enviar recordatorio de pago de V-${p.folio}`;
  return (
    <>
      {p.variant === "button" ? (
        <Button type="button" variant="secondary" onClick={() => setOpen(true)} aria-haspopup="dialog">
          <BellRing size={16} strokeWidth={1.75} aria-hidden /> Enviar recordatorio
        </Button>
      ) : (
        <button
          type="button" className="btn btn-ghost icon-btn reminder-trigger" aria-label={label} data-tip="Enviar recordatorio"
          aria-haspopup="dialog" onClick={() => setOpen(true)}
        >
          <BellRing size={16} strokeWidth={1.75} aria-hidden />
        </button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} title={`Recordatorio de pago · V-${p.folio}`} className="reminder-dialog">
        <ReminderForm {...p} onDone={() => setOpen(false)} />
      </Dialog>
    </>
  );
}

function ReminderForm(p: ReminderDialogProps & { onDone: () => void }) {
  const [state, formAction, pending] = useActionState<ActionResult<unknown> | null, FormData>(
    sendPaymentReminderAction.bind(null, p.saleId), null,
  );
  const [, startTransition] = useTransition();
  const { push } = useToast();
  const msgId = useId();
  const { onDone } = p;

  useEffect(() => {
    if (!state?.ok) return;
    push(state.message ?? "Recordatorio enviado.", "success");
    onDone();
  }, [state, push, onDone]);

  const blocked = !p.mailConfigured || !!p.nextAllowedAt;
  const fieldErrors = state && !state.ok ? state.fieldErrors : undefined;
  const msgError = fieldErrors?.message;

  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }}
    >
      <dl className="reminder-facts">
        <div><dt>Cliente</dt><dd>{p.customer}</dd></div>
        <div><dt>Saldo pendiente</dt><dd className="num">{p.balance}</dd></div>
        <div><dt>Vence</dt><dd>{p.due}</dd></div>
      </dl>

      {p.lastSentAt ? (
        <p className={cn("reminder-last", p.nextAllowedAt && "is-blocked")}>
          <Clock size={14} strokeWidth={1.75} aria-hidden />
          <span>
            Último recordatorio: {fmtDateTime(p.lastSentAt)}.
            {p.nextAllowedAt && <> Podrás enviar otro a partir del {fmtDateTime(p.nextAllowedAt)} (máximo uno cada 12 horas).</>}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted">Aún no se ha enviado ningún recordatorio de esta venta.</p>
      )}
      {!p.mailConfigured && (
        <p role="status" className="reminder-last is-blocked">El envío de correos no está configurado. Contacta al administrador.</p>
      )}

      <FormErrorsContext.Provider value={fieldErrors}>
        <Field label="Para" name="to" type="text" inputMode="email" autoComplete="email" defaultValue={p.to}
          hint="Varios correos separados por coma" required />
        <Field label="CC (opcional)" name="cc" type="text" inputMode="email" />
        <div>
          <label htmlFor={msgId} className="label">Mensaje</label>
          <textarea
            id={msgId} name="message" rows={8} className="input" defaultValue={p.message} required maxLength={3000}
            aria-invalid={!!msgError} aria-describedby={`${msgId}-hint`}
          />
          <p id={`${msgId}-hint`} className={cn("mt-1 text-xs", msgError ? "text-danger" : "text-muted")}>
            {msgError?.[0] ?? `Se envía con los datos de la venta y, si están configurados, los datos bancarios. Las respuestas llegan a ${p.replyTo}.`}
          </p>
        </div>
      </FormErrorsContext.Provider>

      <div className="reminder-actions">
        {state && !state.ok && <p role="status" className="text-sm text-danger">{state.error}</p>}
        <Button type="button" variant="ghost" onClick={onDone}>Cancelar</Button>
        <Button type="submit" disabled={pending || blocked} aria-busy={pending || undefined}>
          {pending ? "Enviando…" : "Enviar recordatorio"}
        </Button>
      </div>
    </form>
  );
}
