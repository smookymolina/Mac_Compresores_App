import Link from "next/link";
import { Handshake } from "lucide-react";
import { requirePagePermission } from "@/lib/auth/session";
import { fmtDateTime, sp } from "@/lib/utils";
import { getPartnerSettings, effectiveDiscount } from "@/modules/partners/pricing";
import { listPartners } from "@/modules/partners/queries";
import { Badge, Card, DataTable, EmptyState, FilteredEmpty, LinkButton, PageHeader, Pager, SearchInput, type DataColumn } from "@/components/ui";
import { pctLabel } from "@/components/socios/pct";

export const metadata = { title: "Socios" };

const COLUMNS: DataColumn[] = [
  { id: "name", header: "Nombre", cellClass: "min-w-40" },
  { id: "company", header: "Empresa · Correo", cellClass: "min-w-48" },
  { id: "discount", header: "Descuento", align: "right" },
  { id: "status", header: "Estado" },
  { id: "seen", header: "Último acceso", cellClass: "whitespace-nowrap" },
];

const STATUS = { all: "Todos", active: "Activos", blocked: "Bloqueados" } as const;
type StatusKey = keyof typeof STATUS;

export default async function PartnersAdminPage({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string; page?: string }> }) {
  await requirePagePermission("partners.manage");
  const { q, estado, page: pageParam } = await searchParams;
  const status: StatusKey = estado === "active" || estado === "blocked" ? estado : "all";
  const [{ items, total, page, pages }, settings] = await Promise.all([
    listPartners({ search: sp(q), page: Number(pageParam) || 1, status: status === "active" ? "ACTIVE" : status === "blocked" ? "BLOCKED" : undefined }),
    getPartnerSettings(),
  ]);
  const qs = (n: number) => `?${new URLSearchParams({ ...(q && { q }), ...(status !== "all" && { estado: status }), page: String(n) })}`;
  const filtered = Boolean(q) || status !== "all";

  return (
    <>
      <PageHeader
        title="Socios comerciales"
        subtitle={`${total.toLocaleString("es-MX")} ${total === 1 ? "socio" : "socios"}`}
        actions={<LinkButton href="/socios-admin/nuevo" className="tap">Agregar socio</LinkButton>}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <LinkButton href="/socios-admin/historial" variant="secondary" className="tap">Historial</LinkButton>
        <LinkButton href="/socios-admin/ajustes" variant="secondary" className="tap">Ajustes de descuento</LinkButton>
      </div>
      <Card className="overflow-hidden">
        <form className="toolbar">
          <SearchInput name="q" defaultValue={q} placeholder="Nombre, empresa o correo" aria-label="Buscar socio" />
          <select name="estado" aria-label="Estado" defaultValue={status} className="input">
            {Object.entries(STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button className="btn btn-secondary">Filtrar</button>
        </form>
        <DataTable
          mobileCards
          caption="Socios comerciales"
          columns={COLUMNS}
          empty={
            filtered ? <FilteredEmpty clearHref="/socios-admin" /> : (
              <EmptyState icon={Handshake} title="Aún no hay socios" action={<LinkButton href="/socios-admin/nuevo" variant="secondary">Agregar socio</LinkButton>}>
                Da de alta a tu primer socio para darle acceso al portal.
              </EmptyState>
            )
          }
          rows={items.map((p) => ({
            id: p.id,
            cells: [
              <Link key="n" className="break-words font-medium text-accent-fg hover:underline" href={`/socios-admin/${p.id}`}>{p.name}</Link>,
              <span key="c" className="block min-w-0 text-left">
                <span className="block break-words">{p.company}</span>
                <span className="block break-all text-xs text-muted">{p.email}</span>
              </span>,
              <span key="d" className="inline-flex flex-wrap items-center justify-end gap-2">
                {pctLabel(effectiveDiscount(p, settings))}
                <Badge tone={p.discountPct === null ? "neutral" : "blue"}>{p.discountPct === null ? "global" : "propio"}</Badge>
              </span>,
              <span key="s" className="inline-flex flex-wrap items-center gap-1">
                <Badge tone={p.status === "ACTIVE" ? "green" : "red"}>{p.status === "ACTIVE" ? "Activo" : "Bloqueado"}</Badge>
                {!p.totpEnabledAt && <Badge tone="amber">2FA pendiente</Badge>}
              </span>,
              p.lastSeenAt ? fmtDateTime(p.lastSeenAt) : <span key="l" className="text-muted">Nunca</span>,
            ],
          }))}
        />
        {total > 0 && <Pager page={page} pages={pages} total={total} noun="socios" href={qs} />}
      </Card>
    </>
  );
}
