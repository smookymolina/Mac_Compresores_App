import Link from "next/link";
import { can, requirePagePermission } from "@/lib/auth/session";
import { listPeriods, listRuleSets } from "@/modules/commissions/service";
import { activateRuleSetAction, createPeriodAction, createRuleSetAction } from "@/modules/commissions/actions";
import { LINE_LABEL, LINES } from "@/modules/products/lines";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, PageHeader, SelectField, TableWrap } from "@/components/ui";
import { fmtPct } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

export const metadata = { title: "Comisiones" };

const BASIS = { NET_SALES: "Venta neta (sin IVA)", MARGIN: "Margen", COLLECTED: "Cobranza (no disponible)" } as const;
const RS_TONE = { DRAFT: "amber", ACTIVE: "green", ARCHIVED: "neutral" } as const;
const RS_LABEL = { DRAFT: "Borrador", ACTIVE: "Activa", ARCHIVED: "Archivada" } as const;

export default async function CommissionsPage() {
  const user = await requirePagePermission("commissions.read_all", "commissions.read_own");
  const [ruleSets, periods] = await Promise.all([listRuleSets(), listPeriods()]);
  const manage = can(user, "commissions.manage");
  const approve = can(user, "commissions.approve");
  const latest = ruleSets[0];

  return (
    <>
      <PageHeader title="Comisiones" subtitle="Tasa verde si el vendedor alcanza su meta del periodo; tasa roja si no la alcanza." />

      <Card className="mb-4">
        <CardHeader title="Periodos" />
        {periods.length === 0 ? (
          <EmptyState title="Sin periodos" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Periodo</th><th>Inicio</th><th>Fin</th><th>Estado</th></tr></thead>
              <tbody>
                {periods.map((p) => (
                  <tr key={p.id}>
                    <td><Link className="font-medium text-accent-fg hover:underline" href={`/comisiones/${p.id}`}>{p.name}</Link></td>
                    <td>{fmtDate(p.startDate)}</td>
                    <td>{fmtDate(p.endDate)}</td>
                    <td>{p.status === "OPEN" ? <Badge tone="blue">Abierto</Badge> : <Badge>Cerrado</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
        {manage && (
          <div className="border-t border-line p-4">
            <ActionForm action={createPeriodAction} submitLabel="Crear periodo" resetOnSuccess variant="secondary">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Nombre (ej. 2026-10)" name="name" required />
                <Field label="Inicio" name="startDate" type="date" required />
                <Field label="Fin" name="endDate" type="date" required />
              </div>
            </ActionForm>
          </div>
        )}
      </Card>

      <h2 className="mb-2 text-sm font-semibold">Reglas versionadas</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {ruleSets.map((rs) => (
          <Card key={rs.id}>
            <CardHeader
              title={`${rs.name} · v${rs.version}`}
              actions={<Badge tone={RS_TONE[rs.status]}>{RS_LABEL[rs.status]}</Badge>}
            />
            <p className="px-4 pt-3 text-xs text-ink-soft">Base: {BASIS[rs.basis]}{rs.notes && ` · ${rs.notes}`}</p>
            <TableWrap>
              <table className="table">
                <thead><tr><th>Línea</th><th className="num">Meta cumplida</th><th className="num">Meta no cumplida</th></tr></thead>
                <tbody>
                  {LINES.map((l) => {
                    const r = rs.rates.find((x) => x.line === l);
                    return (
                      <tr key={l}>
                        <td>{LINE_LABEL[l]}</td>
                        <td className="num"><span className="rounded bg-ok-soft px-2 py-0.5 text-ok">{r ? fmtPct(r.rateMet) : "—"}</span></td>
                        <td className="num"><span className="rounded bg-danger-soft px-2 py-0.5 text-danger">{r ? fmtPct(r.rateNotMet) : "—"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
            {approve && rs.status === "DRAFT" && rs.basis !== "COLLECTED" && (
              <div className="border-t border-line p-4">
                <ActionForm
                  action={activateRuleSetAction.bind(null, rs.id)}
                  submitLabel="Activar versión"
                  confirmText="Confirmo con dirección comercial la base de cálculo, las tasas y que la meta se evalúa sobre el total del vendedor en el periodo."
                />
              </div>
            )}
          </Card>
        ))}
      </div>

      {manage && (
        <Card className="mt-4 p-4">
          <h2 className="mb-3 text-sm font-semibold">Nueva versión de regla</h2>
          <ActionForm action={createRuleSetAction} submitLabel="Crear versión (borrador)">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nombre" name="name" defaultValue={latest?.name ?? "Tabla de comisiones MAC"} required />
              <SelectField label="Base de cálculo" name="basis" defaultValue={latest?.basis} options={Object.entries(BASIS).map(([value, label]) => ({ value, label }))} />
              <Field label="Notas" name="notes" />
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_8rem_8rem]">
              <span className="label">Línea</span><span className="label">Meta cumplida %</span><span className="label">No cumplida %</span>
              {LINES.map((l) => {
                const r = latest?.rates.find((x) => x.line === l);
                return [
                  <span key={`${l}-l`} className="self-center text-sm">{LINE_LABEL[l]}</span>,
                  <input key={`${l}-m`} name={`met_${l}`} aria-label={`Meta cumplida ${l}`} className="input num" defaultValue={r ? r.rateMet.mul(100).toString() : "0"} />,
                  <input key={`${l}-n`} name={`not_${l}`} aria-label={`Meta no cumplida ${l}`} className="input num" defaultValue={r ? r.rateNotMet.mul(100).toString() : "0"} />,
                ];
              })}
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
