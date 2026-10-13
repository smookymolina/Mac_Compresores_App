"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, useToast } from "@/components/ui";
import { resetPartner2faAction, setPartnerStatusAction } from "@/modules/partners/admin-actions";

type Kind = "block" | "unblock" | "reset2fa";

/** Acciones de seguridad del socio. Cada una pide confirmación nombrada (nunca «Aceptar»); el foco inicial va a «Cancelar». */
export function PartnerSecurity({ id, name, blocked }: { id: string; name: string; blocked: boolean }) {
  const [kind, setKind] = useState<Kind | null>(null);
  return (
    <div className="flex flex-wrap gap-2">
      {blocked ? (
        <button type="button" className="btn btn-secondary tap" onClick={() => setKind("unblock")}>Desbloquear acceso</button>
      ) : (
        <button type="button" className="btn btn-secondary tap text-danger" onClick={() => setKind("block")}>Bloquear acceso</button>
      )}
      <button type="button" className="btn btn-secondary tap text-danger" onClick={() => setKind("reset2fa")}>Restablecer 2FA</button>
      <Dialog open={kind !== null} onClose={() => setKind(null)} title={kind === "block" ? `Bloquear a ${name}` : kind === "unblock" ? `Desbloquear a ${name}` : `Restablecer 2FA de ${name}`} side="center">
        {kind && <ConfirmBody kind={kind} id={id} name={name} onClose={() => setKind(null)} />}
      </Dialog>
    </div>
  );
}

function ConfirmBody({ kind, id, name, onClose }: { kind: Kind; id: string; name: string; onClose: () => void }) {
  const router = useRouter();
  const { push } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const cancel = useRef<HTMLButtonElement>(null);

  // showModal() mueve el foco al primer elemento (la X); lo devolvemos a «Cancelar» justo después.
  useEffect(() => {
    const t = window.requestAnimationFrame(() => cancel.current?.focus());
    return () => window.cancelAnimationFrame(t);
  }, []);

  const copy = {
    block: { body: "No podrá iniciar sesión ni buscar precios hasta que lo desbloquees. Su sesión actual se cierra.", label: `Bloquear a ${name}`, done: `${name} quedó bloqueado.`, danger: true },
    unblock: { body: "Podrá iniciar sesión de nuevo con su contraseña y su 2FA.", label: `Desbloquear a ${name}`, done: `${name} quedó desbloqueado.`, danger: false },
    reset2fa: { body: "Borramos su app de verificación y sus códigos de respaldo. En su próximo inicio de sesión tendrá que configurarla de nuevo.", label: `Restablecer 2FA de ${name}`, done: `Restableciste el 2FA de ${name}.`, danger: true },
  }[kind];

  const confirm = () =>
    start(async () => {
      setError("");
      const r = kind === "reset2fa"
        ? await resetPartner2faAction({ id })
        : await setPartnerStatusAction({ id, status: kind === "block" ? "BLOCKED" : "ACTIVE", reason: kind === "block" && reason.trim() ? reason.trim() : undefined });
      if (r.ok) {
        push(copy.done, "success");
        onClose();
        router.refresh();
      } else setError(r.error);
    });

  return (
    <div className="space-y-4 p-4">
      <p className="text-sm text-ink-soft">{copy.body}</p>
      {kind === "block" && (
        <div>
          <label htmlFor="block-reason" className="label">Motivo (opcional)</label>
          <input id="block-reason" className="input" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="dialog-actions">
        <button ref={cancel} type="button" className="btn btn-secondary tap" onClick={onClose}>Cancelar</button>
        <button type="button" className={`btn tap ${copy.danger ? "btn-danger" : "btn-primary"}`} disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
          {pending ? "Procesando…" : copy.label}
        </button>
      </div>
    </div>
  );
}
