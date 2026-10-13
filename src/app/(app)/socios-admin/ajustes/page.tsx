import Link from "next/link";
import { requirePagePermission } from "@/lib/auth/session";
import { getPartnerSettings } from "@/modules/partners/pricing";
import { getPartnerCounts } from "@/modules/partners/queries";
import { Card, CardHeader, PageHeader } from "@/components/ui";
import { SettingsForm } from "@/components/socios/settings-form";

export const metadata = { title: "Ajustes de socios" };

export default async function PartnerSettingsPage() {
  await requirePagePermission("partners.manage");
  const [settings, counts] = await Promise.all([getPartnerSettings(), getPartnerCounts()]);
  return (
    <>
      <PageHeader title="Ajustes de descuento" subtitle="Valores globales del portal de socios." actions={<Link className="btn btn-secondary tap" href="/socios-admin">Volver a socios</Link>} />
      <Card>
        <CardHeader title="Descuento y cuota global" />
        <SettingsForm discountPct={settings.discountPct.toString()} dailyQuota={settings.dailyQuota} onGlobal={counts.onGlobal} total={counts.total} />
      </Card>
    </>
  );
}
