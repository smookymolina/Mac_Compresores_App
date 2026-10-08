import { requirePagePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader, TableWrap } from "@/components/ui";
import { fmtDateTime, sp } from "@/lib/utils";

export const metadata = { title: "Auditoría" };

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
      <Card>
        <form className="flex flex-wrap gap-2 border-b border-line p-3">
          <input name="entity" defaultValue={p.entity} placeholder="Entidad (Quote, Sale…)" className="input max-w-48" />
          <input name="action" defaultValue={p.action} placeholder="Acción (quote., sale.…)" className="input max-w-48" />
          <button className="rounded-md border border-line bg-white px-3 text-sm hover:bg-slate-50">Filtrar</button>
        </form>
        {rows.length === 0 ? (
          <EmptyState title="Sin eventos" />
        ) : (
          <TableWrap>
            <table className="table">
              <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{fmtDateTime(r.createdAt)}</td>
                    <td>{r.user?.name ?? "—"}</td>
                    <td><code className="text-xs">{r.action}</code></td>
                    <td className="text-xs">{r.entity} {r.entityId?.slice(0, 8)}</td>
                    <td className="max-w-md truncate text-xs text-ink-soft">{r.data ? JSON.stringify(r.data) : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
