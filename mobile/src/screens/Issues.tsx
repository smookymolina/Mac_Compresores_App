import { useState } from "react";
import { useApp, type SyncIssue, type SyncIssueEntity } from "../core";
import { Alert, Button, Card, errMsg } from "../ui/kit";
import { SyncStateBadge, issueText } from "../ui/sync";

const ENTITY: Record<SyncIssueEntity, string> = { Quote: "Cotización", Customer: "Cliente", Sale: "Venta", Payment: "Pago", InventoryMovement: "Movimiento de inventario" };

/** ¿El servicio permite descartarla? (venta pendiente rechazada o pago rechazado). */
const dismissible = (i: SyncIssue) => i.sync.state === "rejected" && (i.entity === "Payment" || (i.entity === "Sale" && i.id.startsWith("pending-sale:")));

export function IssuesCard({ onOpen }: { onOpen: (i: SyncIssue) => void }) {
  const app = useApp();
  const { issues, pendingCount } = app;
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function dismiss(i: SyncIssue) {
    setBusy(i.id); setErr(null);
    try { await (i.entity === "Payment" ? app.sales.dismissRejected(i.parentId!, i.id) : app.sales.dismissRejected(i.id)); }
    catch (e) { setErr(errMsg(e)); }
    finally { setBusy(null); }
  }

  return (
    <Card title="Pendientes / incidencias">
      <p className="text-sm text-muted">{pendingCount === 0 ? "No hay cambios por enviar." : `${pendingCount} ${pendingCount === 1 ? "cambio" : "cambios"} por enviar al sincronizar.`}</p>
      {err && <div className="mt-2"><Alert>{err}</Alert></div>}
      {issues.length === 0 ? (
        <p className="mt-2 text-sm text-muted">Sin incidencias.</p>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {issues.map((i) => (
            <li key={`${i.entity}:${i.id}`} className="py-2">
              <button type="button" onClick={() => onOpen(i)} className="block min-h-11 w-full text-left">
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-medium text-accent-fg">{ENTITY[i.entity]} · {i.label}</span>
                  <SyncStateBadge sync={i.sync} short />
                </span>
                <span className={`block text-sm ${i.sync.state === "rejected" ? "text-danger" : "text-ink-soft"}`}>{issueText(i.sync)}</span>
              </button>
              {dismissible(i) && (
                <Button variant="ghost" className="mt-1 px-3 text-sm" busy={busy === i.id} onClick={() => void dismiss(i)}>Descartar</Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
