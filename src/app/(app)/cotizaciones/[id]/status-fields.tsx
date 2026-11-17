"use client";
import { useState } from "react";
import type { QuoteStatus } from "@prisma/client";
import { SelectField } from "@/components/ui";
import { LOST_REASON_LABEL, MANUAL_LOST_REASONS, QUOTE_STATUS_LABEL, requiresLostReason } from "@/modules/quotes/status";

const reasonOptions = [
  { value: "", label: "Selecciona un motivo" },
  ...MANUAL_LOST_REASONS.map((r) => ({ value: r, label: LOST_REASON_LABEL[r] })),
];

/** Campos de cambio de estado: el motivo de pérdida aparece (y es obligatorio) al rechazar o cancelar. El servidor lo vuelve a validar. */
export function StatusFields({ transitions }: { transitions: readonly QuoteStatus[] }) {
  const [to, setTo] = useState<QuoteStatus>(transitions[0]);
  const lost = requiresLostReason(to);
  return (
    <>
      <SelectField label="Nuevo estado" name="to" value={to} onChange={(e) => setTo(e.target.value as QuoteStatus)}
        options={transitions.map((t) => ({ value: t, label: QUOTE_STATUS_LABEL[t] }))} />
      {lost && <LostReasonFields required />}
    </>
  );
}

export function LostReasonFields({ required, defaultReason, defaultNote }: { required?: boolean; defaultReason?: string | null; defaultNote?: string | null }) {
  const [reason, setReason] = useState(defaultReason ?? "");
  return (
    <>
      <SelectField label="Motivo de pérdida" name="lostReason" required={required} value={reason}
        onChange={(e) => setReason(e.target.value)}
        options={defaultReason === "ABANDONED" ? [...reasonOptions, { value: "ABANDONED", label: LOST_REASON_LABEL.ABANDONED }] : reasonOptions} />
      <label className="block text-xs text-ink-soft">Nota {reason === "OTHER" ? "(obligatoria)" : "(opcional)"}
        <textarea name="lostNote" className="input mt-1" rows={2} maxLength={500} required={reason === "OTHER"} defaultValue={defaultNote ?? ""} />
      </label>
    </>
  );
}
