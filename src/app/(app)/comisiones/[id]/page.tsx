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
import { Badge, Card, CardHeader, EmptyState, DataTable, Field, PageHeader, SelectField } from "@/components/ui";
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
      <PageHeader title={`Comisiones ${period.name}`} meta={[
        { label: "Periodo", value: `${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}` },
        { label: "Estado", value: period.status === "OPEN" ? "Abierto" : "Cerrado" },
      ]} />

      {manage && (
        <div className="mb-4 grid gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden lg:col-span-2">
            <CardHeader title="Metas por vendedor" />
            <DataTable
              caption="Metas por vendedor"
              columns={[{ id: "vend", header: "Vendedor", sortable: true }, { id: "meta", header: "Meta", align: "right", sortable: true }]}
              rows={period.targets.map((t) => ({ id: t.id, cells: [t.seller.name, fmtMoney(t.amount)], sort: [t.seller.name, t.amount.toNumber()] }))}
              empty={<EmptyState title="Sin metas">Define la meta de cada vendedor con el formulario de abajo.</EmptyState>}
            />
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
        <Card><EmptyState title="Sin comisiones calculadas">Calcula el periodo para ver las comisiones por vendedor.</EmptyState></Card>
      ) : (
        <div className="space-y-4">
          {[...bySeller.entries()].map(([sellerId, rows]) => {
            const first = rows[0];
            const total = rows.reduce((a, r) => a.add(r.amount), dec(0));
            const states = new Set(rows.map((r) => r.status));
            return (
              <Card key={sellerId} className="overflow-hidden">
                <CardHeader
                  title={first.seller.name}
                  actions={
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {first.metTarget ? <Badge tone="green">Meta cumplida</Badge> : <Badge tone="red">Meta no cumplida</Badge>}
                      <span>Base {fmtMoney(first.sellerTotal)} / meta {fmtMoney(first.targetAmount)}</span>
                      <span className="text-ink-soft">Regla v{first.ruleSet.version}</span>
                    </span>
                  }
                />
                <DataTable
                  caption={`Comisiones de ${first.seller.name}`}
                  columns={[
                    { id: "linea", header: "Línea" },
                    { id: "base", header: "Base", align: "right" },
                    { id: "tasa", header: "Tasa", align: "right" },
                    { id: "com", header: "Comisión", align: "right" },
                    { id: "estado", header: "Estado" },
                  ]}
                  rows={rows.map((r) => ({
                    id: r.id,
                    cells: [
                      LINE_LABEL[r.line],
                      fmtMoney(r.baseAmount),
                      <span key="t" className={r.metTarget ? "text-ok" : "text-danger"}>{fmtPct(r.rate)}</span>,
                      fmtMoney(r.amount),
                      <Badge key="e" tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>,
                    ],
                  }))}
                  foot={["Total", null, null, fmtMoney(total), null]}
                />
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
