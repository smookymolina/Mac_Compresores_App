import { getQuotaRemaining, mxDate } from "@/modules/partners/guard";
import { getPartnerSettings } from "@/modules/partners/pricing";
import { requirePartner } from "@/modules/partners/session";
import { PORTAL_CONTACT } from "@/components/socios/contact";
import { PortalHeader } from "@/components/socios/portal-header";
import { PriceSearch } from "@/components/socios/price-search";

export const metadata = { title: "Precios de socio" };

/** dd/mm/aaaa del día siguiente en Ciudad de México (cuando se reinicia la cuota). */
function nextResetOn(): string {
  const [y, m, d] = mxDate().split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return `${String(next.getUTCDate()).padStart(2, "0")}/${String(next.getUTCMonth() + 1).padStart(2, "0")}/${next.getUTCFullYear()}`;
}

export default async function PartnerHomePage() {
  const { partner } = await requirePartner();
  const [remaining, settings] = await Promise.all([getQuotaRemaining(partner), getPartnerSettings()]);
  return (
    <>
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2">
        Saltar al contenido
      </a>
      <PortalHeader name={partner.name} company={partner.company} />
      <PriceSearch
        remaining={remaining}
        quota={partner.dailyQuota ?? settings.dailyQuota}
        resetOn={nextResetOn()}
        contact={PORTAL_CONTACT}
      />
    </>
  );
}
