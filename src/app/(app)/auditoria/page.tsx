import { ShieldCheck } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Card, DataTable, EmptyState, FilteredEmpty, PageHeader, type DataColumn } from "@/components/ui";
import { fmtDateTime, sp } from "@/lib/utils";

export const metadata = { title: "Auditoría" };

const COLUMNS: DataColumn[] = [
  { id: "date", header: "Fecha", sortable: true, cellClass: "whitespace-nowrap" },
  { id: "user", header: "Usuario", sortable: true },
  { id: "action", header: "Acción", sortable: true },
  { id: "entity", header: "Entidad", sortable: true },
  { id: "data", header: "Detalle" },
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ entity?: string; action?: string }> }) {
  await requirePagePermission("audit.read");
  const p = await searchParams;
  const rows = await db.auditLog.findMany({
    where: {
      ...(sp(p.entity) && { entity: sp(p.entity) }),
      ...(sp(p.action) && { action: { startsWith: sp(p.action) } }),
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <PageHeader title="Auditoría" subtitle="Últimos 200 eventos." />
      <Card className="overflow-hidden">
        <form className="toolbar">
          <input name="entity" defaultValue={p.entity} placeholder="Entidad (Quote, Sale…)" aria-label="Entidad" className="input" />
          <input name="action" defaultValue={p.action} placeholder="Acción (quote., sale.…)" aria-label="Acción" className="input" />
          <button className="btn btn-secondary">Filtrar</button>
        </form>
        <DataTable
          caption="Eventos de auditoría"
          columns={COLUMNS}
          empty={p.entity || p.action ? <FilteredEmpty clearHref="/auditoria" /> : <EmptyState icon={ShieldCheck} title="Sin eventos">Cada operación crítica queda registrada aquí.</EmptyState>}
          rows={rows.map((r) => ({
            id: r.id,
            cells: [
              fmtDateTime(r.createdAt), r.user?.name ?? "—",
              <code key="a" className="mono">{r.action}</code>,
              <span key="e" className="text-xs">{r.entity} <span className="mono text-muted">{r.entityId?.slice(0, 8)}</span></span>,
              <span key="d" className="block max-w-md truncate text-xs text-ink-soft">{r.data ? JSON.stringify(r.data) : ""}</span>,
            ],
            sort: [r.createdAt.getTime(), r.user?.name ?? null, r.action, r.entity, null],
          }))}
        />
      </Card>
    </>
  );
}
