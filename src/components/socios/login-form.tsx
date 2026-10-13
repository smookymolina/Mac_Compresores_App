"use client";

import { useActionState, useEffect, useRef, useTransition } from "react";
import { Lock, Mail } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { partnerLoginAction } from "@/modules/partners/portal-actions";
import { PasswordField } from "@/components/ui/fields";
import { ContactLine, PORTAL_CONTACT } from "./contact";

const GENERIC = "No pudimos iniciar sesión con esos datos. Revisa tu correo y contraseña, o contacta a MAC Compresores.";
const TOO_MANY = "Hay demasiados intentos seguidos. Espera unos minutos e inténtalo de nuevo.";

/** El servidor no revela cuál dato falló; aquí solo se elige el texto del spec según el tipo de error. */
export function loginMessage(error: string): { text: string; blocked: boolean } {
  if (/bloquead/i.test(error)) return { text: error, blocked: true };
  if (/demasiados/i.test(error)) return { text: TOO_MANY, blocked: false };
  return { text: GENERIC, blocked: false };
}

export function LoginForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(partnerLoginAction, null);
  const [, start] = useTransition();
  const email = useRef<HTMLInputElement>(null);
  const failed = state && !state.ok ? state : null;
  const msg = failed ? loginMessage(failed.error) : null;

  useEffect(() => {
    if (failed) email.current?.focus(); // foco al campo correo tras un error
  }, [failed]);

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(() => action(fd)); // envío manual: React no vacía el formulario si hay error
      }}
      className="auth-fields"
    >
      {msg && (
        <div role="alert" className="portal-error">
          <p>{msg.text}</p>
          {msg.blocked && <ContactLine contact={PORTAL_CONTACT} />}
        </div>
      )}
      <div>
        <label htmlFor="partner-email" className="label">Correo electrónico</label>
        <div className="input-wrap has-icon">
          <input
            ref={email} id="partner-email" name="email" type="email" className="input" autoComplete="username"
            spellCheck={false} autoCapitalize="none" required aria-invalid={!!failed}
          />
          <span aria-hidden className="input-icon"><Mail size={16} strokeWidth={1.75} /></span>
        </div>
      </div>
      <PasswordField label="Contraseña" name="password" autoComplete="current-password" required icon={<Lock size={16} strokeWidth={1.75} />} />
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Iniciando sesión…" : "Iniciar sesión"}
      </button>
    </form>
  );
}
