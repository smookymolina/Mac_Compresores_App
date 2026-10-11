import { Fragment } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pageArgs, paged } from "@/lib/pagination";
import { uuid } from "@/lib/validation";
import { Card, DataTable, EmptyState, FilteredEmpty, PageHeader, Pager, type DataColumn } from "@/components/ui";
import { fmtDateTime, sp } from "@/lib/utils";
import { ACTION_LABEL, actionLabel, describeDetail, detailIds, entityLabel } from "@/modules/audit/labels";

export const metadata = { title: "Auditoría" };

const COLUMNS: DataColumn[] = [
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "user", header: "Usuario", sortable: true, cellClass: "min-w-32" },
  { id: "action", header: "Acción", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "entity", header: "Entidad", sortable: true },
  { id: "data", header: "Detalle" },
];

/** Entidades con página propia: el identificador del evento enlaza al registro. */
const ENTITY_HREF: Record<string, string> = {
  Customer: "/clientes/", Product: "/productos/", Quote: "/cotizaciones/", Sale: "/ventas/", CommissionPeriod: "/comisiones/",
};

const YMD = /^\d{4}-\d{2}-\d{2}$/;
type SP = { entity?: string; action?: string; user?: string; desde?: string; hasta?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  await requirePagePermission("audit.read");
  const p = await searchParams;
  const entity = sp(p.entity);
  const action = sp(p.action);
  const userId = p.user && uuid.safeParse(p.user).success ? p.user : undefined;
  const from = p.desde && YMD.test(p.desde) ? p.desde : undefined;
  const to = p.hasta && YMD.test(p.hasta) ? p.hasta : undefined;
  // Fechas capturadas en hora de Ciudad de México (UTC-6, sin horario de verano).
  const where: Prisma.AuditLogWhereInput = {
    ...(entity && { entity }),
    ...(action && { action: { startsWith: action } }),
    ...(userId && { userId }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: new Date(`${from}T00:00:00-06:00`) }),
        ...(to && { lt: new Date(new Date(`${to}T00:00:00-06:00`).getTime() + 864e5) }),
      },
    }),
  };
  const { page, skip, take } = pageArgs(Number(p.page) || 1);
  const [items, total, entities, users] = await Promise.all([
    db.auditLog.findMany({ where, include: { user: { select: { name: true } } }, orderBy: { createdAt: "desc" }, skip, take }),
    db.auditLog.count({ where }),
    db.auditLog.groupBy({ by: ["entity"], orderBy: { entity: "asc" } }),
    db.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const { pages } = paged(items, total, page);
  // Nombres para los identificadores que aparecen en los detalles (usuarios, roles, almacenes).
  const ids = [...new Set(items.flatMap((r) => detailIds(r.data)))];
  const [roles, warehouses] = ids.length
    ? await Promise.all([
        db.role.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
        db.warehouse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }),
      ])
    : [[], []];
  const names = new Map([...users, ...roles, ...warehouses].map((x) => [x.id, x.name]));
  const filters: Record<string, string> = {
    ...(entity && { entity }), ...(action && { action }), ...(userId && { user: userId }), ...(from && { desde: from }), ...(to && { hasta: to }),
  };
  const filtered = Object.keys(filters).length > 0;
  const qs = (n: number) => `?${new URLSearchParams({ ...filters, page: String(n) })}`;

  return (
    <>
      <PageHeader title="Auditoría" subtitle={`${total.toLocaleString("es-MX")} eventos${filtered ? " con los filtros aplicados" : ""}.`} />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <select name="entity" aria-label="Entidad" defaultValue={entity ?? ""} className="input">
            <option value="">Todas las entidades</option>
            {entities.map((e) => <option key={e.entity} value={e.entity}>{entityLabel(e.entity)}</option>)}
          </select>
          <select name="user" aria-label="Usuario" defaultValue={userId ?? ""} className="input">
            <option value="">Todos los usuarios</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <select name="action" aria-label="Acción" defaultValue={action ?? ""} className="input">
            <option value="">Todas las acciones</option>
            {Object.entries(ACTION_LABEL).sort((a, b) => a[1].localeCompare(b[1], "es")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <label className="audit-date">
            <span>Desde</span>
            <input type="date" name="desde" defaultValue={from} className="input" />
          </label>
          <label className="audit-date">
            <span>Hasta</span>
            <input type="date" name="hasta" defaultValue={to} className="input" />
          </label>
          <button className="btn btn-secondary">Filtrar</button>
        </form>
        <DataTable mobileCards
          caption="Eventos de auditoría"
          columns={COLUMNS}
          empty={filtered ? <FilteredEmpty clearHref="/auditoria" /> : <EmptyState icon={ShieldCheck} title="Sin eventos">Cada operación crítica queda registrada aquí.</EmptyState>}
          rows={items.map((r) => {
            const base = ENTITY_HREF[r.entity];
            const short = r.entityId?.slice(0, 8);
            const detail = describeDetail(r.action, r.data, names);
            return {
              id: r.id,
              cells: [
                fmtDateTime(r.createdAt), r.user?.name ?? "—",
                <span key="a" title={r.action}>{actionLabel(r.action)}</span>,
                <span key="e" className="text-xs">
                  {entityLabel(r.entity)}{" "}
                  {base && r.entityId && uuid.safeParse(r.entityId).success
                    ? <Link className="mono text-accent-fg hover:underline" href={`${base}${r.entityId}`} aria-label={`Ver ${entityLabel(r.entity)} ${short}`}>{short}</Link>
                    : <span className="mono text-muted">{short}</span>}
                </span>,
                detail.length ? (
                  <details key="d" className="w-full max-w-full text-xs text-ink-soft sm:w-auto sm:max-w-md">
                    <summary className="cursor-pointer truncate py-1">{detail.map((x) => `${x.label}: ${x.value}`).join(" · ")}</summary>
                    <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                      {detail.map((x) => <Fragment key={x.label}><dt className="font-medium text-ink">{x.label}</dt><dd className="break-words">{x.value}</dd></Fragment>)}
                    </dl>
                  </details>
                ) : "",
              ],
              sort: [r.createdAt.getTime(), r.user?.name ?? null, actionLabel(r.action), entityLabel(r.entity), null],
            };
          })}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="eventos" href={qs} />}
      </Card>
    </>
  );
}
