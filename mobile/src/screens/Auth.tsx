import { useEffect, useRef, useState, type FormEvent } from "react";
import { biometryAvailable, isValidPin, API_URL, APP_VERSION, useApp } from "../core";
import { Alert, AuthScreen, Button, Field, Spinner, bioPref } from "../ui/kit";
import { ENTITY_LABEL } from "../ui/format";

const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

function defaultDeviceName() {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const m = /Android[^;]*;\s*([^;)]+?)(?:\s+Build|\))/.exec(ua);
  if (m?.[1]) return m[1].trim();
  if (/iPhone/.test(ua)) return "iPhone";
  return "Teléfono de campo";
}

export function Login({ notice }: { notice?: string | null }) {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [device, setDevice] = useState(defaultDeviceName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const host = API_URL ? API_URL.replace(/^https?:\/\//, "") : "(sin configurar)";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await app.login(email.trim(), password, device.trim() || "Teléfono de campo");
    } catch (err) {
      setError(errMsg(err, "No se pudo iniciar sesión. Revisa tu conexión."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Iniciar sesión" subtitle={<>Servidor: <span className="font-medium text-ink-soft">{host}</span></>}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        {notice && <Alert tone="warn">{notice}</Alert>}
        <Field label="Correo" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Nombre del dispositivo" name="device" hint="Así lo verá el administrador." value={device} onChange={(e) => setDevice(e.target.value)} />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" busy={busy} disabled={!email || !password || !API_URL}>Entrar</Button>
      </form>
    </AuthScreen>
  );
}

function PinInput({ label, value, onChange, autoFocus, error }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; error?: string | null }) {
  return (
    <Field
      label={label}
      name={label.toLowerCase().replace(/\s+/g, "-")}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      maxLength={6}
      autoFocus={autoFocus}
      value={value}
      error={error}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      className="tracking-[0.5em]"
    />
  );
}

export function CreatePin() {
  const app = useApp();
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [bio, setBio] = useState(false);
  const [bioOk, setBioOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void biometryAvailable().then((ok) => { setBioOk(ok); setBio(ok); }); }, []);

  const mismatch = confirm.length >= pin.length && confirm.length > 0 && confirm !== pin;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) return setError("El PIN debe tener de 4 a 6 dígitos.");
    if (pin !== confirm) return setError("Los PIN no coinciden.");
    setBusy(true);
    setError(null);
    try {
      bioPref.set(bioOk && bio);
      await app.setPin(pin);
    } catch (err) {
      setError(errMsg(err, "No se pudo guardar el PIN."));
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Crea tu PIN" subtitle={<>Hola{app.user ? `, ${app.user.name}` : ""}. El PIN protege los datos guardados en este teléfono.</>}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <PinInput label="PIN (4 a 6 dígitos)" value={pin} onChange={setPin} autoFocus />
        <PinInput label="Confirma tu PIN" value={confirm} onChange={setConfirm} error={mismatch ? "Los PIN no coinciden." : null} />
        {bioOk && (
          <label className="flex min-h-11 items-center gap-3 text-ink">
            <input type="checkbox" className="size-5 accent-[var(--accent)]" checked={bio} onChange={(e) => setBio(e.target.checked)} />
            Desbloquear también con huella
          </label>
        )}
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" busy={busy} disabled={!isValidPin(pin) || pin !== confirm}>Guardar PIN</Button>
      </form>
    </AuthScreen>
  );
}

export function Unlock({ onWiped }: { onWiped: () => void }) {
  const app = useApp();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bio, setBio] = useState(false);
  const tried = useRef(false);

  async function tryBio() {
    const ok = await app.unlockBiometric();
    if (!ok) setError("No se reconoció la huella. Usa tu PIN.");
  }

  useEffect(() => {
    if (!bioPref.get()) return;
    void biometryAvailable().then((ok) => {
      setBio(ok);
      if (ok && !tried.current) { tried.current = true; void tryBio(); }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isValidPin(pin)) return setError("Escribe tu PIN de 4 a 6 dígitos.");
    setBusy(true);
    setError(null);
    try {
      const r = await app.unlock(pin);
      if (!r.ok) {
        setPin("");
        if (r.wiped) return onWiped();
        setError(r.remaining === 1 ? "PIN incorrecto. Te queda 1 intento antes de borrar los datos del teléfono." : `PIN incorrecto. Te quedan ${r.remaining} intentos.`);
      }
    } catch (err) {
      setError(errMsg(err, "No se pudo verificar el PIN."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Desbloquear" subtitle={app.user ? `${app.user.name} · ${app.user.email}` : undefined}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <PinInput label="PIN" value={pin} onChange={setPin} autoFocus />
        {error && <Alert>{error}</Alert>}
        <Button type="submit" className="w-full" busy={busy} disabled={pin.length < 4}>Desbloquear</Button>
        {bio && <Button variant="secondary" className="w-full" onClick={() => void tryBio()}>Usar huella</Button>}
      </form>
    </AuthScreen>
  );
}

export function InitialDownload() {
  const app = useApp();
  const p = app.progress;
  const syncing = app.status === "syncing";
  return (
    <AuthScreen title="Descarga inicial" subtitle="Bajamos el catálogo y tus clientes para que funcionen sin conexión. Puede tardar unos minutos.">
      <div className="space-y-4">
        {syncing ? (
          <div className="flex items-center gap-3" role="status" aria-live="polite">
            <Spinner />
            <div>
              <p className="font-medium text-ink">{p ? ENTITY_LABEL[p.entity] ?? p.entity : "Conectando…"}</p>
              {p && <p className="text-sm text-muted">{p.loaded.toLocaleString("es-MX")} descargados</p>}
            </div>
          </div>
        ) : app.status === "offline" ? (
          <Alert tone="warn">Sin conexión. Conéctate a internet para la descarga inicial.</Alert>
        ) : (
          app.error && <Alert>{app.error}</Alert>
        )}
        {!syncing && <Button className="w-full" onClick={() => void app.syncNow()}>Reintentar</Button>}
      </div>
    </AuthScreen>
  );
}

export function UpgradeRequired() {
  const app = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  useEffect(() => {
    app.controller.api.version().then((v) => {
      setLatest(v.latest);
      setUrl(/iPhone|iPad/.test(navigator.userAgent) ? v.iosUrl : v.androidUrl);
    }, () => {});
  }, [app.controller]);
  return (
    <AuthScreen title="Actualización requerida" subtitle={`Esta versión (${APP_VERSION}) ya no es compatible con el servidor.`}>
      <div className="space-y-4">
        <p className="text-ink">Instala la versión más reciente{latest ? ` (${latest})` : ""} para seguir sincronizando. Tus datos guardados no se pierden.</p>
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-11 w-full items-center justify-center rounded-md bg-brand px-4 font-medium text-white">Descargar actualización</a>
        ) : (
          <Alert tone="info">Pide el enlace de descarga a tu administrador.</Alert>
        )}
      </div>
    </AuthScreen>
  );
}
