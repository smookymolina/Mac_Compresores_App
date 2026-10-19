import { useEffect, useState } from "react";
import { useApp } from "./core";
import { Loading } from "./ui/kit";
import { CreatePin, InitialDownload, Login, Unlock, UpgradeRequired } from "./screens/Auth";
import { Shell } from "./screens/Shell";

/** Enrutado por estado: alta → PIN → desbloqueo → actualización → descarga inicial → app. */
export function App() {
  const app = useApp();
  const [notice, setNotice] = useState<string | null>(null);
  const { registered } = app;
  // Mensaje al volver a la pantalla de acceso (PIN bloqueado o dispositivo revocado).
  const [wasRegistered, setWas] = useState(registered);
  useEffect(() => {
    if (wasRegistered && !registered && !notice) setNotice("La sesión de este dispositivo terminó. Inicia sesión de nuevo.");
    if (registered) setNotice(null);
    setWas(registered);
  }, [registered]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!app.ready) return <Loading label="Abriendo MAC Campo…" />;
  if (!registered) return <Login notice={notice} />;
  if (app.needsPin) return <CreatePin />;
  if (app.locked) return <Unlock onWiped={() => setNotice("Demasiados intentos de PIN. Por seguridad se borraron los datos del teléfono; inicia sesión de nuevo.")} />;
  if (app.upgradeRequired) return <UpgradeRequired />;
  if (!app.lastSyncAt) return <InitialDownload />;
  return <Shell />;
}
