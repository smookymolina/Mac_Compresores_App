"use client";

import { useActionState, useTransition } from "react";
import { Lock } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { partnerActivateAction } from "@/modules/partners/portal-actions";
import { PasswordField } from "@/components/ui/fields";

/** Crear contraseña desde el enlace de invitación o restablecimiento. */
export function ActivateForm({ token, email }: { token: string; email: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(partnerActivateAction, null);
  const [, start] = useTransition();
  const failed = state && !state.ok ? state : null;
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
      <input type="hidden" name="token" value={token} />
      {/* Para que el gestor de contraseñas guarde el par correo/contraseña. */}
      <input type="email" name="username" value={email} autoComplete="username" readOnly hidden />
      {failed && <div role="alert" className="portal-error"><p>{failed.error}</p></div>}
      <PasswordField label="Contraseña nueva" name="password" autoComplete="new-password" required minLength={10}
        hint="Mínimo 10 caracteres." icon={<Lock size={16} strokeWidth={1.75} aria-hidden />} />
      <PasswordField label="Repite la contraseña" name="confirm" autoComplete="new-password" required minLength={10}
        icon={<Lock size={16} strokeWidth={1.75} aria-hidden />} />
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Guardando…" : "Crear contraseña y entrar"}
      </button>
    </form>
  );
}
