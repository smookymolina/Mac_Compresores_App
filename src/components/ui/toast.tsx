"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";

type ToastTone = "success" | "error";
interface ToastItem { id: number; tone: ToastTone; message: string }
interface ToastApi { push: (message: string, tone?: ToastTone) => void }

const NOOP: ToastApi = { push: () => {} };
const ToastContext = createContext<ToastApi>(NOOP);

/** Devuelve `push(mensaje, tono)`; sin proveedor (p. ej. en pruebas) no hace nada. */
export const useToast = () => useContext(ToastContext);

const LIFETIME_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback<ToastApi["push"]>((message, tone = "success") => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { id, tone, message }]);
    setTimeout(() => dismiss(id), LIFETIME_MS);
  }, [dismiss]);
  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 max-md:pb-24 md:items-end">
        {items.map((t) => {
          const Icon = t.tone === "success" ? CheckCircle2 : CircleAlert;
          return (
            <div key={t.id} className="page-enter pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border border-line bg-panel p-3 text-sm text-ink shadow-[var(--elev-pop)]">
              <Icon size={18} strokeWidth={1.75} aria-hidden className={cn("mt-px shrink-0", t.tone === "success" ? "text-ok" : "text-danger")} />
              <p className="min-w-0 flex-1">{t.message}</p>
              <button type="button" aria-label="Cerrar aviso" onClick={() => dismiss(t.id)} className="btn btn-ghost btn-sm -my-1 -mr-1 !min-h-7 !px-1.5">
                <X size={14} strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
