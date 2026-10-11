"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal o drawer sobre <dialog> nativo: showModal() aporta aria-modal, trampa de foco, Esc y
 * restauración del foco. El contenido solo se monta mientras está abierto.
 */
export function Dialog({
  open, onClose, title, side = "center", className, children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "center" | "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // Respaldo para navegadores sin <dialog> modal (Safari < 15.4): se muestra con el atributo open.
    // También si showModal() falla (WebViews antiguos): .dialog-fallback lo fija en pantalla con fondo propio.
    if (open && !d.open) {
      try { d.showModal(); } catch { d.classList.add("dialog-fallback"); d.setAttribute("open", ""); }
    }
    if (!open && d.open) {
      try { d.close(); } catch { d.removeAttribute("open"); }
      d.classList.remove("dialog-fallback");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn("dialog", `dialog-${side}`, className)}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} // clic en el fondo
    >
      {open && (
        <div className="dialog-frame flex h-full flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
            <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
            <button type="button" aria-label="Cerrar" data-tip="Cerrar" onClick={onClose} className="btn btn-ghost icon-btn">
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain">{children}</div>
        </div>
      )}
    </dialog>
  );
}
