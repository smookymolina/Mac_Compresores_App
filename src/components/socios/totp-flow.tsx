"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { Copy, Download } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { partnerTotpSetupAction, partnerTotpVerifyAction } from "@/modules/partners/portal-actions";
import { ContactLine, PORTAL_CONTACT } from "./contact";

const WRONG_CODE = "Ese código no coincide. Espera al siguiente código de tu app e inténtalo de nuevo. Si sigue fallando, activa la hora automática en tu teléfono.";

function codeMessage(error: string): { text: string; blocked: boolean; expired: boolean } {
  if (/bloquead/i.test(error)) return { text: error, blocked: true, expired: false };
  if (/expir/i.test(error)) return { text: error, blocked: false, expired: true };
  if (/incorrecto/i.test(error)) return { text: WRONG_CODE, blocked: false, expired: false };
  return { text: error, blocked: false, expired: false };
}

/** Campo de código + envío. `backup` permite alternar a código de respaldo (solo con 2FA ya activo). */
function CodeForm({ canUseBackup, submitLabel }: { canUseBackup: boolean; submitLabel: string }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(partnerTotpVerifyAction, null);
  const [, start] = useTransition();
  const [backup, setBackup] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const failed = state && !state.ok ? state : null;
  const msg = failed ? codeMessage(failed.error) : null;
  useEffect(() => {
    if (failed) input.current?.select();
  }, [failed]);

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
      {msg && (
        <div role="alert" className="portal-error">
          <p>{msg.text}</p>
          {msg.blocked && <ContactLine contact={PORTAL_CONTACT} />}
          {msg.expired && <p><Link className="auth-link" href="/socios/login">Volver a iniciar sesión</Link></p>}
        </div>
      )}
      <div>
        <label htmlFor="partner-code" className="label">{backup ? "Código de respaldo" : "Código de 6 dígitos"}</label>
        <input
          key={backup ? "backup" : "totp"} ref={input} id="partner-code" name="code" className="input mono" required
          autoComplete="one-time-code" autoCapitalize="none" spellCheck={false} aria-invalid={!!failed}
          inputMode={backup ? "text" : "numeric"} maxLength={backup ? 20 : 6} pattern={backup ? undefined : "[0-9]*"}
          placeholder={backup ? "xxxxx-xxxxx" : "000000"}
        />
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending} aria-busy={pending || undefined}>
        {pending ? "Verificando…" : submitLabel}
      </button>
      {canUseBackup && (
        <button type="button" className="btn btn-ghost" onClick={() => setBackup((v) => !v)}>
          {backup ? "Usar el código de mi app" : "Usar un código de respaldo"}
        </button>
      )}
    </form>
  );
}

/** Paso 2 del acceso cuando el 2FA ya está activo. */
export function TotpVerify() {
  return <CodeForm canUseBackup submitLabel="Verificar código" />;
}

type Setup = { qr: string; secret: string; backupCodes: string[] };

/**
 * Alta del 2FA: 1) QR + clave + códigos de respaldo (una sola vez, sin recargar), 2) confirmar con un código de 6 dígitos.
 * El servidor genera el secreto al montar; si el socio recarga, se genera uno nuevo (nada se activa hasta confirmar).
 */
export function TotpSetup() {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"save" | "verify">("save");
  const [saved, setSaved] = useState(false); // copió o descargó
  const [wait, setWait] = useState(true); // 3 s de cortesía
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    partnerTotpSetupAction()
      .then((r) => (r.ok && r.data ? setSetup(r.data) : setError(r.ok ? "No pudimos preparar la verificación." : r.error)))
      .catch(() => setError("No pudimos preparar la verificación. Revisa tu conexión e inténtalo de nuevo."));
  }, []);

  useEffect(() => {
    if (!setup) return;
    const t = window.setTimeout(() => setWait(false), 3000);
    return () => window.clearTimeout(t);
  }, [setup]);

  if (error)
    return (
      <div role="alert" className="portal-error">
        <p>{error}</p>
        <p className="mt-2"><Link className="auth-link" href="/socios/login">Volver a iniciar sesión</Link></p>
      </div>
    );
  if (!setup)
    return (
      <div role="status" aria-busy="true" className="space-y-3">
        <span className="sr-only">Preparando la verificación…</span>
        <div aria-hidden className="skeleton mx-auto" style={{ width: 216, height: 216 }} />
        <div aria-hidden className="skeleton h-4 w-3/4" />
      </div>
    );

  const text = setup.backupCodes.join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setSaved(true);
    } catch {
      /* sin portapapeles: queda Descargar */
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([`Códigos de respaldo · MAC Compresores\n\n${text}\n`], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "codigos-respaldo-mac.txt";
    a.click();
    URL.revokeObjectURL(url);
    setSaved(true);
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="s1" className="space-y-3">
        <h2 id="s1" className="text-sm font-medium">1. Escanea este código QR con Google Authenticator, Microsoft Authenticator o Authy.</h2>
        {/* eslint-disable-next-line @next/next/no-img-element -- data URL generada en el servidor */}
        <img src={setup.qr} alt="Código QR para tu app de verificación" width={192} height={192} className="portal-qr" />
        <p className="text-sm text-ink-soft">¿No puedes escanear? Escribe esta clave en tu app:</p>
        <p className="mono break-all rounded-md bg-panel-2 p-2 text-center" style={{ userSelect: "all" }}>{setup.secret}</p>
      </section>

      {stage === "save" ? (
        <section aria-labelledby="s-codes" className="space-y-3">
          <h2 id="s-codes" className="sr-only">Códigos de respaldo</h2>
          <p className="portal-warn" role="note">Guarda estos códigos ahora. No volverás a verlos y cada uno sirve una sola vez.</p>
          <ul className="portal-codes mono" aria-label="Códigos de respaldo">
            {setup.backupCodes.map((c) => <li key={c}>{c}</li>)}
          </ul>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary flex-1 gap-2" onClick={copy}><Copy size={16} strokeWidth={1.75} aria-hidden /> Copiar códigos</button>
            <button type="button" className="btn btn-secondary flex-1 gap-2" onClick={download}><Download size={16} strokeWidth={1.75} aria-hidden /> Descargar códigos</button>
          </div>
          <p role="status" className="text-xs text-ink-soft">{saved ? "Códigos guardados. Ya puedes continuar." : wait ? "" : "Puedes continuar cuando los hayas guardado."}</p>
          <button type="button" className="btn btn-primary w-full" disabled={!saved && wait} onClick={() => setStage("verify")}>Ya los guardé</button>
        </section>
      ) : (
        <section aria-labelledby="s2" className="space-y-3">
          <h2 id="s2" className="text-sm font-medium">2. Escribe el código de 6 dígitos que muestra tu app.</h2>
          <CodeForm canUseBackup={false} submitLabel="Activar verificación" />
        </section>
      )}
    </div>
  );
}
