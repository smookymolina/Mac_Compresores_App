"use client";

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Modal o drawer sobre <dialog> nativo: showModal() aporta aria-modal, trampa de foco, Esc y
 * restauración del foco. El contenido solo se monta mientras está abierto.
 */
export function Dialog({
  open, onClose, title, side = "center", children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  side?: "center" | "left" | "right";
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={cn("dialog", `dialog-${side}`)}
      onClose={onClose}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }} // clic en el fondo
    >
      {open && (
        <div className="flex h-full max-h-dvh flex-col">
          <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-line px-4">
            <h2 id={titleId} className="text-sm font-semibold">{title}</h2>
            <button type="button" aria-label="Cerrar" onClick={onClose} className="btn btn-ghost btn-sm !px-2">
              <X size={16} strokeWidth={1.75} aria-hidden />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
