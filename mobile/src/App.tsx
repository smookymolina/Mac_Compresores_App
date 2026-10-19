import { useApp } from "./core";

/** Marcador de posición: las pantallas (alta, PIN, catálogo…) se construyen sobre `useApp()`. */
export function App() {
  const app = useApp();
  const label = app.status === "syncing" ? "Sincronizando…" : app.status === "online" ? "En línea" : `Sin conexión — ${app.pending} pendientes`;
  return (
    <main className="min-h-dvh p-4">
      <header className="flex items-center justify-between rounded-md border border-line bg-panel p-3 shadow-sm">
        <strong className="text-ink">MAC Campo</strong>
        <span className="text-sm text-muted" role="status">{label}</span>
      </header>
      {app.error && <p className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{app.error}</p>}
    </main>
  );
}
