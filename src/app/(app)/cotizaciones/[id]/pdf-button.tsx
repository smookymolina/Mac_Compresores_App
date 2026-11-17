"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download } from "lucide-react";
import { btnClass } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { confirmQuoteSentAction } from "@/modules/quotes/actions";

/** Enlace de descarga del PDF; si la cotización es borrador, pregunta después si ya se envió. */
export function PdfButton({ quoteId, folio, askSent }: { quoteId: string; folio: number | string; askSent: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function confirm() {
    setError(null);
    start(async () => {
      const res = await confirmQuoteSentAction(quoteId);
      if (!res.ok) { setError(res.error); return; }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <a
        className={btnClass("secondary")}
        href={`/api/cotizaciones/${quoteId}/pdf`}
        target="_blank"
        rel="noopener"
        aria-label="Descargar PDF"
        onClick={() => { if (askSent) { setError(null); setOpen(true); } }}
      >
        <Download size={16} strokeWidth={1.75} aria-hidden /> PDF
      </a>
      {askSent && (
        <Dialog open={open} onClose={() => setOpen(false)} title="¿Ya la enviaste?" className="max-w-md">
          <div className="space-y-4 p-4">
            <p className="text-sm">¿Ya enviaste la cotización C-{folio} al cliente?</p>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" className={btnClass("secondary")} onClick={() => setOpen(false)} disabled={pending}>Todavía no</button>
              <button type="button" className={btnClass("primary")} onClick={confirm} disabled={pending} autoFocus>
                {pending ? "Guardando…" : "Sí, marcar como enviada"}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
