import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { getPeriodDetail } from "@/modules/commissions/service";
import {
  approveSellerAction, calculatePeriodAction, closePeriodAction, paySellerAction, setTargetAction,
} from "@/modules/commissions/actions";
import { listSellers } from "@/modules/users/service";
import { LINE_LABEL } from "@/modules/products/lines";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, PageHeader, SelectField, TableWrap } from "@/components/ui";
import { dec, fmtMoney, fmtPct } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

const STATUS = { CALCULATED: ["Calculada", "amber"], APPROVED: ["Aprobada", "blue"], PAID: ["Pagada", "green"] } as const;

export default async function PeriodPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("commissions.read_all", "commissions.read_own");
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { period, entries } = await getPeriodDetail(user, id).catch((e) => {
    if (e instanceof AppError) notFound();
    throw e;
  });
  const manage = can(user, "commissions.manage") && period.status === "OPEN";
  const approve = can(user, "commissions.approve");
  const sellers = manage ? await listSellers() : [];

  const bySeller = new Map<string, typeof entries>();
  for (const e of entries) bySeller.set(e.sellerId, [...(bySeller.get(e.sellerId) ?? []), e]);

  return (
    <>
      <PageHeader title={`Comisiones ${period.name}`} subtitle={`${fmtDate(period.startDate)} – ${fmtDate(period.endDate)} · ${period.status === "OPEN" ? "Abierto" : "Cerrado"}`} />

      {manage && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title="Metas por vendedor" />
            <TableWrap>
              <table className="table">
                <thead><tr><th>Vendedor</th><th className="num">Meta</th></tr></thead>
                <tbody>
                  {period.targets.map((t) => <tr key={t.id}><td>{t.seller.name}</td><td className="num">{fmtMoney(t.amount)}</td></tr>)}
                </tbody>
              </table>
            </TableWrap>
            <div className="border-t border-line p-4">
              <ActionForm action={setTargetAction.bind(null, period.id)} submitLabel="Guardar meta" variant="secondary">
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField label="Vendedor" name="sellerId" options={sellers.map((s) => ({ value: s.id, label: s.name }))} />
                  <Field label="Meta del periodo (misma base que la regla)" name="amount" inputMode="decimal" required />
                </div>
              </ActionForm>
            </div>
          </Card>
          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">Cálculo</h3>
            <p className="text-xs text-ink-soft">Usa ventas confirmadas del periodo y la regla activa. Sin meta registrada se aplica la tasa de “meta no cumplida”. No recalcula si ya hay aprobaciones.</p>
            <ActionForm action={calculatePeriodAction.bind(null, period.id)} submitLabel="Calcular / recalcular" />
            {approve && <ActionForm action={closePeriodAction.bind(null, period.id)} submitLabel="Cerrar periodo" variant="secondary" confirmText="Todas las comisiones están aprobadas." />}
          </Card>
        </div>
      )}

      {bySeller.size === 0 ? (
        <Card><EmptyState title="Sin comisiones calculadas" /></Card>
      ) : (
        <div className="space-y-4">
          {[...bySeller.entries()].map(([sellerId, rows]) => {
            const first = rows[0];
            const total = rows.reduce((a, r) => a.add(r.amount), dec(0));
            const states = new Set(rows.map((r) => r.status));
            return (
              <Card key={sellerId}>
                <CardHeader
                  title={first.seller.name}
                  actions={
                    <span className="flex items-center gap-2 text-xs">
                      {first.metTarget ? <Badge tone="green">Meta cumplida</Badge> : <Badge tone="red">Meta no cumplida</Badge>}
                      <span>Base {fmtMoney(first.sellerTotal)} / meta {fmtMoney(first.targetAmount)}</span>
                      <span className="text-ink-soft">Regla v{first.ruleSet.version}</span>
                    </span>
                  }
                />
                <TableWrap>
                  <table className="table">
                    <thead><tr><th>Línea</th><th className="num">Base</th><th className="num">Tasa</th><th className="num">Comisión</th><th>Estado</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>{LINE_LABEL[r.line]}</td>
                          <td className="num">{fmtMoney(r.baseAmount)}</td>
                          <td className="num"><span className={r.metTarget ? "text-ok" : "text-danger"}>{fmtPct(r.rate)}</span></td>
                          <td className="num">{fmtMoney(r.amount)}</td>
                          <td><Badge tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge></td>
                        </tr>
                      ))}
                      <tr><td className="font-semibold">Total</td><td /><td /><td className="num font-semibold">{fmtMoney(total)}</td><td /></tr>
                    </tbody>
                  </table>
                </TableWrap>
                {approve && (states.has("CALCULATED") || states.has("APPROVED")) && (
                  <div className="flex gap-2 border-t border-line p-3">
                    {states.has("CALCULATED") && <ActionForm action={approveSellerAction.bind(null, period.id, sellerId)} submitLabel="Aprobar" />}
                    {states.has("APPROVED") && <ActionForm action={paySellerAction.bind(null, period.id, sellerId)} submitLabel="Marcar pagada" variant="secondary" confirmText="Pago realizado." />}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
