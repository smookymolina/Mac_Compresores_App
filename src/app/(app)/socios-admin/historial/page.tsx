import Link from "next/link";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { PartnerActivityType } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/session";
import { fmtDateTime, sp } from "@/lib/utils";
import { uuid } from "@/lib/validation";
import { listPartnerActivity, listPartnerOptions } from "@/modules/partners/queries";
import { Badge, Card, DataTable, FilteredEmpty, PageHeader, Pager, type DataColumn } from "@/components/ui";
import { ACTIVITY, ACTIVITY_GROUPS, SEVERITY, activityDetail, type Severity } from "@/components/socios/activity-map";

export const metadata = { title: "Historial de socios" };

const COLUMNS: DataColumn[] = [
  { id: "at", header: "Fecha y hora", cellClass: "mono whitespace-nowrap" },
  { id: "partner", header: "Socio", cellClass: "min-w-32" },
  { id: "event", header: "Evento", cellClass: "min-w-48" },
  { id: "detail", header: "Detalle", cellClass: "min-w-32" },
  { id: "ip", header: "IP", cellClass: "mono" },
  { id: "ua", header: "Dispositivo" },
];
const SEV_ICON = { info: Info, warning: AlertTriangle, critical: ShieldAlert } as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function PartnerHistoryPage({ searchParams }: { searchParams: Promise<{ partnerId?: string; type?: string; from?: string; to?: string; page?: string }> }) {
  await requirePagePermission("partners.manage");
  const sa = await searchParams;
  const partnerId = uuid.safeParse(sp(sa.partnerId)).success ? sp(sa.partnerId) : undefined;
  const type = sp(sa.type) && sp(sa.type)! in PartnerActivityType ? sp(sa.type) : undefined;
  const from = sp(sa.from) && DATE.test(sp(sa.from)!) ? sp(sa.from) : undefined;
  const to = sp(sa.to) && DATE.test(sp(sa.to)!) ? sp(sa.to) : undefined;
  const badRange = Boolean(from && to && to < from);

  const [partners, { items, total, page, pages }] = await Promise.all([
    listPartnerOptions(),
    listPartnerActivity({
      partnerId, type,
      // México: el día completo en hora local se aproxima con el huso fijo UTC-6 (sin horario de verano desde 2022).
      from: from && !badRange ? `${from}T00:00:00-06:00` : undefined,
      to: to && !badRange ? `${to}T23:59:59.999-06:00` : undefined,
      page: Number(sa.page) || 1,
    }),
  ]);
  const filtered = Boolean(partnerId || type || from || to);
  const qs = (n: number) => `?${new URLSearchParams({ ...(partnerId && { partnerId }), ...(type && { type }), ...(from && { from }), ...(to && { to }), page: String(n) })}`;

  return (
    <>
      <PageHeader title="Historial de socios" subtitle="Accesos, consultas y eventos de seguridad del portal." actions={<Link className="btn btn-secondary tap" href="/socios-admin">Volver a socios</Link>} />
      <Card className="overflow-hidden">
        <form className="toolbar items-end" aria-label="Filtros del historial">
          <div className="min-w-0 flex-[1_1_12rem]">
            <label htmlFor="f-partner" className="label">Socio</label>
            <select id="f-partner" name="partnerId" defaultValue={partnerId ?? ""} className="input w-full max-w-none">
              <option value="">Todos los socios</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.company}</option>)}
            </select>
          </div>
          <div className="min-w-0 flex-[1_1_12rem]">
            <label htmlFor="f-type" className="label">Tipo de evento</label>
            <select id="f-type" name="type" defaultValue={type ?? ""} className="input w-full max-w-none">
              <option value="">Todos los eventos</option>
              {ACTIVITY_GROUPS.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.types.map((t) => <option key={t} value={t}>{ACTIVITY[t].label}</option>)}
                </optgroup>
              ))}
            </select>
          </div>
          <div className="min-w-0 flex-[1_1_9rem]">
            <label htmlFor="f-from" className="label">Desde</label>
            <input id="f-from" name="from" type="date" defaultValue={from ?? ""} className="input w-full max-w-none" aria-describedby={badRange ? "f-range" : undefined} />
          </div>
          <div className="min-w-0 flex-[1_1_9rem]">
            <label htmlFor="f-to" className="label">Hasta</label>
            <input id="f-to" name="to" type="date" defaultValue={to ?? ""} className="input w-full max-w-none" aria-invalid={badRange} aria-describedby={badRange ? "f-range" : undefined} />
          </div>
          <div className="flex gap-2 max-md:w-full max-md:flex-col">
            <button className="btn btn-secondary tap">Filtrar</button>
            {filtered && <Link href="/socios-admin/historial" className="btn btn-ghost tap">Limpiar filtros</Link>}
          </div>
          {badRange && <p id="f-range" role="alert" className="w-full text-sm text-danger">La fecha final debe ser igual o posterior a la inicial.</p>}
        </form>
        <DataTable
          mobileCards
          caption="Historial de actividad de socios"
          columns={COLUMNS}
          empty={<FilteredEmpty clearHref="/socios-admin/historial" />}
          rows={items.map((a) => {
            const m = ACTIVITY[a.type];
            const sev: Severity = m.severity;
            const Icon = SEV_ICON[sev];
            const detail = activityDetail(a.type, a.meta);
            return {
              id: a.id,
              cells: [
                fmtDateTime(a.createdAt),
                <Link key="p" className="break-words font-medium text-accent-fg hover:underline" href={`/socios-admin/${a.partnerId}`}>{a.partner.name}</Link>,
                <span key="e" className="inline-flex flex-wrap items-center justify-end gap-2 md:justify-start">
                  <Badge tone={SEVERITY[sev].tone}><Icon size={12} strokeWidth={1.75} aria-hidden />{SEVERITY[sev].label}</Badge>
                  <span>{m.label}</span>
                </span>,
                detail || <span key="d" className="text-muted">—</span>,
                a.ip ?? "—",
                <span key="u" title={a.userAgent ?? undefined} className="block text-xs text-muted max-md:break-words md:max-w-56 md:truncate">{a.userAgent ?? "—"}</span>,
              ],
            };
          })}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="movimientos" href={qs} />}
      </Card>
    </>
  );
}
