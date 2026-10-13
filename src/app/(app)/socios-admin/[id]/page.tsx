import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePagePermission } from "@/lib/auth/session";
import { fmtDateTime } from "@/lib/utils";
import { effectiveDiscount, getPartnerSettings } from "@/modules/partners/pricing";
import { getPartner, listPartnerActivity } from "@/modules/partners/queries";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui";
import { ACTIVITY, SEVERITY, activityDetail } from "@/components/socios/activity-map";
import { PartnerForm } from "@/components/socios/partner-form";
import { PartnerSecurity } from "@/components/socios/partner-security";
import { pctLabel } from "@/components/socios/pct";
import { uuid } from "@/lib/validation";

export const metadata = { title: "Socio" };

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePagePermission("partners.manage");
  const { id } = await params;

  if (id === "nuevo") {
    const settings = await getPartnerSettings();
    return (
      <>
        <PageHeader title="Nuevo socio" subtitle="Da de alta a un socio para darle acceso al portal de precios." />
        <Card>
          <CardHeader title="Datos del socio" />
          <PartnerForm values={{ name: "", company: "", email: "", discountPct: "", dailyQuota: "" }} globalPct={settings.discountPct.toString()} globalQuota={settings.dailyQuota} />
        </Card>
      </>
    );
  }

  if (!uuid.safeParse(id).success) notFound();
  const found = await getPartner(id);
  if (!found) notFound();
  const { partner: p, settings } = found;
  const recent = (await listPartnerActivity({ partnerId: id, page: 1 })).items.slice(0, 10);
  const effective = effectiveDiscount(p, settings);

  return (
    <>
      <PageHeader
        title={p.name}
        subtitle={`${p.company} · ${p.email}`}
        meta={[
          { label: "Estado", value: <Badge tone={p.status === "ACTIVE" ? "green" : "red"}>{p.status === "ACTIVE" ? "Activo" : "Bloqueado"}</Badge> },
          { label: "2FA", value: p.totpEnabledAt ? "Activa" : "Pendiente" },
          { label: "Descuento efectivo", value: `${pctLabel(effective)} · ${p.discountPct === null ? "global" : "propio"}` },
          { label: "Último acceso", value: p.lastSeenAt ? fmtDateTime(p.lastSeenAt) : "Nunca" },
        ]}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader title="Datos del socio" />
          <PartnerForm
            values={{ id: p.id, name: p.name, company: p.company, email: p.email, discountPct: p.discountPct?.toString() ?? "", dailyQuota: p.dailyQuota?.toString() ?? "" }}
            globalPct={settings.discountPct.toString()}
            globalQuota={settings.dailyQuota}
          />
        </Card>
        <Card>
          <CardHeader title="Seguridad" description={p.status === "BLOCKED" && p.blockedReason ? `Motivo del bloqueo: ${p.blockedReason}` : undefined} />
          <div className="p-4"><PartnerSecurity id={p.id} name={p.name} blocked={p.status === "BLOCKED"} /></div>
        </Card>
        <Card>
          <CardHeader title="Actividad reciente" actions={<Link className="text-sm font-medium text-accent-fg hover:underline" href={`/socios-admin/historial?partnerId=${p.id}`}>Ver historial de {p.name}</Link>} />
          {recent.length === 0 ? (
            <p className="p-4 text-sm text-ink-soft">Este socio aún no tiene actividad.</p>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((a) => {
                const meta = ACTIVITY[a.type];
                const detail = activityDetail(a.type, a.meta);
                return (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
                    <span className="mono whitespace-nowrap text-muted">{fmtDateTime(a.createdAt)}</span>
                    <Badge tone={SEVERITY[meta.severity].tone}>{SEVERITY[meta.severity].label}</Badge>
                    <span>{meta.label}</span>
                    {detail && <span className="text-xs text-muted">{detail}</span>}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
