import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pageArgs, paged } from "@/lib/pagination";
import { uuid } from "@/lib/validation";
import { Card, DataTable, EmptyState, FilteredEmpty, PageHeader, Pager, type DataColumn } from "@/components/ui";
import { fmtDateTime, sp } from "@/lib/utils";

export const metadata = { title: "Auditoría" };

const COLUMNS: DataColumn[] = [
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "user", header: "Usuario", sortable: true },
  { id: "action", header: "Acción", sortable: true },
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
            {entities.map((e) => <option key={e.entity} value={e.entity}>{e.entity}</option>)}
          </select>
          <select name="user" aria-label="Usuario" defaultValue={userId ?? ""} className="input">
            <option value="">Todos los usuarios</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input name="action" defaultValue={action} placeholder="Acción (quote., sale.…)" aria-label="Acción" className="input" />
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
        <DataTable
          caption="Eventos de auditoría"
          columns={COLUMNS}
          empty={filtered ? <FilteredEmpty clearHref="/auditoria" /> : <EmptyState icon={ShieldCheck} title="Sin eventos">Cada operación crítica queda registrada aquí.</EmptyState>}
          rows={items.map((r) => {
            const base = ENTITY_HREF[r.entity];
            const short = r.entityId?.slice(0, 8);
            const detail = r.data ? JSON.stringify(r.data) : "";
            return {
              id: r.id,
              cells: [
                fmtDateTime(r.createdAt), r.user?.name ?? "—",
                <code key="a" className="mono">{r.action}</code>,
                <span key="e" className="text-xs">
                  {r.entity}{" "}
                  {base && r.entityId && uuid.safeParse(r.entityId).success
                    ? <Link className="mono text-accent-fg hover:underline" href={`${base}${r.entityId}`} aria-label={`Ver ${r.entity} ${short}`}>{short}</Link>
                    : <span className="mono text-muted">{short}</span>}
                </span>,
                <span key="d" className="block max-w-md truncate text-xs text-ink-soft" title={detail || undefined}>{detail}</span>,
              ],
              sort: [r.createdAt.getTime(), r.user?.name ?? null, r.action, r.entity, null],
            };
          })}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="eventos" href={qs} />}
      </Card>
    </>
  );
}
