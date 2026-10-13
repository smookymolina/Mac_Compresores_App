"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";
import { partnerEmailCodeAction, partnerResendCodeAction } from "@/modules/partners/portal-actions";
import { ContactLine, PORTAL_CONTACT } from "./contact";

/** Paso 2 del acceso: código de 6 dígitos que llegó al correo del socio. */
export function EmailCodeForm({ email }: { email: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(partnerEmailCodeAction, null);
  const [, start] = useTransition();
  const [resend, setResend] = useState<{ busy: boolean; msg?: string }>({ busy: false });
  const input = useRef<HTMLInputElement>(null);
  const failed = state && !state.ok ? state : null;
  const blocked = failed ? /bloquead/i.test(failed.error) : false;
  const expired = failed ? /expir/i.test(failed.error) : false;
  useEffect(() => {
    if (failed) input.current?.select();
  }, [failed]);

  const again = async () => {
    setResend({ busy: true });
    const r = await partnerResendCodeAction();
    setResend({ busy: false, msg: r.ok ? "Te enviamos un código nuevo." : r.error });
  };

  return (
    <form
      noValidate
      className="auth-fields"
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(() => action(fd));
      }}
    >
      <p className="text-sm text-ink-soft">Te enviamos un código de 6 dígitos a <strong>{email}</strong>. Revisa también la carpeta de spam.</p>
      {failed && (
        <div id="code-error" role="alert" className="portal-error">
          <p>{failed.error}</p>
          {blocked && <ContactLine contact={PORTAL_CONTACT} />}
          {expired && <p><Link className="auth-link" href="/socios/login">Volver a iniciar sesión</Link></p>}
        </div>
      )}
      <div>
        <label htmlFor="partner-code" className="label">Código de 6 dígitos</label>
        <input
          ref={input} id="partner-code" name="code" className="input mono" required autoFocus
          autoComplete="one-time-code" inputMode="numeric" maxLength={6} pattern="[0-9]*" placeholder="000000"
          aria-invalid={!!failed} aria-describedby={failed ? "code-error" : undefined}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Verificando…" : "Entrar"}
      </button>
      <button type="button" className="btn btn-ghost" onClick={again} disabled={resend.busy}>
        {resend.busy ? "Enviando…" : "Enviarme otro código"}
      </button>
      <p role="status" className="text-xs text-ink-soft">{resend.msg ?? "Este navegador quedará recordado 30 días."}</p>
    </form>
  );
}
