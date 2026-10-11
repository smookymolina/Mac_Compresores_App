import Link from "next/link";
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
  const { period, entries, summary } = await getPeriodDetail(user, id).catch((e) => {
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
              {sellers.length === 0 ? (
                <p className="text-sm text-ink-soft">No hay vendedores activos para asignar metas. Da de alta usuarios con rol Ventas.</p>
              ) : (
                <ActionForm action={setTargetAction.bind(null, period.id)} submitLabel="Guardar meta" variant="secondary">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField label="Vendedor" name="sellerId" options={sellers.map((s) => ({ value: s.id, label: s.name }))} />
                    <Field label="Meta mensual de venta total (O.C., sin IVA)" name="amount" inputMode="decimal" required />
                  </div>
                </ActionForm>
              )}
            </div>
          </Card>
          <Card className="space-y-3 p-4">
            <h3 className="text-sm font-semibold">Cálculo</h3>
            <p className="text-xs text-ink-soft">Comisionan solo las ventas cobradas al 100% dentro del mes, sobre la utilidad neta después de gastos. El % alto/bajo es el del mes de la O.C. (si se cobra después, conserva el % de ese mes). Se recalcula solo cada día; no recalcula si ya hay aprobaciones.</p>
            <ActionForm action={calculatePeriodAction.bind(null, period.id)} submitLabel="Calcular / recalcular" />
            {approve && <ActionForm action={closePeriodAction.bind(null, period.id)} submitLabel="Cerrar periodo" variant="secondary" confirmText="Todas las comisiones están aprobadas." />}
          </Card>
        </div>
      )}

      {summary.length > 0 && (
        <Card className="mb-4 overflow-hidden">
          <CardHeader title="Meta del mes (venta total por O.C.)" />
          <DataTable mobileCards
            caption="Meta del mes por vendedor"
            columns={[
              { id: "v", header: "Vendedor" }, { id: "t", header: "Venta total", align: "right" },
              { id: "m", header: "Meta", align: "right" }, { id: "e", header: "Estado" }, { id: "p", header: "O.C. sin cobrar (no comisionan este mes)" },
            ]}
            rows={summary.map((r) => ({
              id: r.sellerId,
              cells: [
                r.name, fmtMoney(r.monthTotal), fmtMoney(r.target),
                r.met ? <Badge key="b" tone="green">Meta cumplida · % alto</Badge> : <Badge key="b" tone="red">No cumplida · % bajo</Badge>,
                r.pendingFolios.length ? r.pendingFolios.map((f) => `V-${f}`).join(", ") : "—",
              ],
            }))}
          />
        </Card>
      )}

      {bySeller.size === 0 ? (
        <Card><EmptyState title="Sin comisiones calculadas">{manage ? "Calcula el periodo para ver las comisiones por vendedor." : "Aparecerán aquí cuando gerencia calcule el periodo."}</EmptyState></Card>
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
                      <span className="text-ink-soft">Regla v{first.ruleSet.version}</span>
                    </span>
                  }
                />
                <DataTable mobileCards
                  caption={`Comisiones de ${first.seller.name}`}
                  columns={[
                    { id: "venta", header: "Venta" },
                    { id: "linea", header: "Línea" },
                    { id: "meta", header: "Mes de la O.C." },
                    { id: "base", header: "Utilidad neta", align: "right" },
                    { id: "tasa", header: "Tasa", align: "right" },
                    { id: "com", header: "Comisión", align: "right" },
                    { id: "estado", header: "Estado" },
                  ]}
                  rows={rows.map((r) => ({
                    id: r.id,
                    cells: [
                      r.sale ? <Link key="v" className="text-accent-fg hover:underline" href={`/ventas/${r.sale.id}`}>V-{r.sale.folio}</Link> : "—",
                      LINE_LABEL[r.line],
                      <span key="m" className="text-xs">
                        {r.sale && fmtDate(r.sale.confirmedAt)}{r.collectedAt && ` · cobrada ${fmtDate(r.collectedAt)}`}
                        <span className={r.metTarget ? "block text-ok" : "block text-danger"}>{r.metTarget ? "Meta cumplida" : "Meta no cumplida"} ({fmtMoney(r.sellerTotal)} / {fmtMoney(r.targetAmount)})</span>
                      </span>,
                      fmtMoney(r.baseAmount),
                      <span key="t" className={r.metTarget ? "text-ok" : "text-danger"}>{fmtPct(r.rate)}</span>,
                      fmtMoney(r.amount),
                      <Badge key="e" tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Badge>,
                    ],
                  }))}
                  foot={["Total", null, null, null, null, fmtMoney(total), null]}
                />
                {approve && (states.has("CALCULATED") || states.has("APPROVED")) && (
                  <div className="flex flex-wrap gap-2 border-t border-line p-3 max-sm:[&>*]:flex-1">
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
