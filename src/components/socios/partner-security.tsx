"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, useToast } from "@/components/ui";
import { deletePartnerAction, resendPartnerInviteAction, resetPartner2faAction, setPartnerStatusAction } from "@/modules/partners/admin-actions";

type Kind = "block" | "unblock" | "reset2fa" | "invite" | "delete";

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
      <button type="button" className="btn btn-secondary tap" onClick={() => setKind("invite")}>Enviar enlace de contraseña</button>
      <button type="button" className="btn btn-secondary tap text-danger" onClick={() => setKind("reset2fa")}>Quitar app de verificación</button>
      <button type="button" className="btn btn-secondary tap text-danger" onClick={() => setKind("delete")}>Eliminar socio</button>
      <Dialog open={kind !== null} onClose={() => setKind(null)} title={kind === "block" ? `Bloquear a ${name}` : kind === "unblock" ? `Desbloquear a ${name}` : kind === "invite" ? `Enlace de contraseña para ${name}` : kind === "delete" ? `Eliminar a ${name}` : `Quitar app de verificación de ${name}`} side="center">
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
    unblock: { body: "Podrá iniciar sesión de nuevo con su contraseña y el código que le llega por correo.", label: `Desbloquear a ${name}`, done: `${name} quedó desbloqueado.`, danger: false },
    reset2fa: { body: "Borramos su app de verificación y sus códigos de respaldo y cerramos su sesión. Desde su próximo acceso recibirá el código por correo.", label: "Quitar app de verificación", done: `Quitaste la app de verificación de ${name}.`, danger: true },
    delete: { body: "Se borra el socio, su acceso y su bitácora de actividad. No se puede deshacer. Si solo quieres quitarle el acceso, mejor bloquéalo.", label: `Eliminar a ${name}`, done: `Eliminaste a ${name}.`, danger: true },
    invite: { body: "Le enviamos por correo un enlace (un solo uso, vence en 72 horas) para crear una contraseña nueva. Sirve para la invitación pendiente o si olvidó su contraseña.", label: "Enviar enlace", done: `Enviamos el enlace a ${name}.`, danger: false },
  }[kind];

  const confirm = () =>
    start(async () => {
      setError("");
      if (kind === "delete") {
        const r = await deletePartnerAction({ id });
        if (!r.ok) return setError(r.error);
        push(copy.done, "success");
        onClose();
        router.push("/socios-admin");
        return;
      }
      if (kind === "invite") {
        const r = await resendPartnerInviteAction({ id });
        if (!r.ok) return setError(r.error);
        if (r.data?.url) return setError(`No se pudo enviar el correo. Comparte este enlace por un canal seguro: ${r.data.url}`);
        push(copy.done, "success");
        onClose();
        router.refresh();
        return;
      }
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
