import type { EntitySync, SyncConflict } from "../core";
import { Alert, Badge } from "./kit";
import { money, qty } from "./format";

/** Insignia de `_sync` para cualquier captura (cliente, venta, pago, movimiento, contacto…). */
export function SyncStateBadge({ sync, short }: { sync?: EntitySync; short?: boolean }) {
  const s = sync?.state;
  if (s === "pending") return <Badge tone="warn">{short ? "Pendiente" : "Pendiente de sincronizar"}</Badge>;
  if (s === "conflict") return <Badge tone="info">En revisión</Badge>;
  if (s === "rejected") return <Badge tone="danger">Rechazado</Badge>;
  return null;
}

const conflictOf = (s?: EntitySync) => (s?.conflict && typeof s.conflict === "object" ? (s.conflict as SyncConflict) : null);

/** Texto según el tipo de incidencia: precio, existencia, RFC duplicado o rechazo. */
export function issueText(s: EntitySync): string {
  if (s.state === "rejected") return s.error ?? "Rechazado por el servidor.";
  const c = conflictOf(s);
  if (c?.kind === "price") return "Los precios cambiaron desde que la capturaste. Gerencia lo revisará.";
  if (c?.kind === "stock") {
    const list = (c.items ?? []).map((i) => `${i.sku} (pides ${qty(i.requested)}, hay ${qty(i.available)})`).join(", ");
    return `Sin existencia suficiente: ${list || "almacén sin existencias"}; gerencia decidirá.`;
  }
  if (c?.kind === "duplicate_rfc") return `Ya existe otro cliente con el RFC ${c.rfc}. Búscalo y úsalo en lugar de crear uno nuevo; gerencia lo revisará.`;
  return s.error ?? "En revisión por gerencia.";
}

/** Aviso de sincronización en un detalle (null si ya está aplicado). */
export function SyncNotice({ sync, pendingText = "Pendiente de sincronizar. Está guardado en el teléfono y se enviará al conectar." }: { sync?: EntitySync; pendingText?: string }) {
  if (!sync || sync.state === "applied") return null;
  if (sync.state === "pending") return <Alert tone="warn">{pendingText}</Alert>;
  const c = conflictOf(sync);
  return (
    <Alert tone={sync.state === "rejected" ? "danger" : "info"}>
      <p className="font-medium">{sync.state === "rejected" ? "Rechazado por el servidor" : "En revisión"}</p>
      <p>{issueText(sync)}</p>
      {c?.kind === "price" && c.items?.length > 0 && (
        <ul className="mt-1 text-xs">{c.items.map((i) => <li key={i.productId}><span className="font-mono">{i.sku}</span>: {money(i.clientPrice)} → {money(i.serverPrice)}</li>)}</ul>
      )}
    </Alert>
  );
}
