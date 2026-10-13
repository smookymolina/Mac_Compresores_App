import { redirect } from "next/navigation";
import { getPendingPartner } from "@/modules/partners/session";
import { PortalAuthShell } from "@/components/socios/portal-auth-shell";
import { TotpSetup, TotpVerify } from "@/components/socios/totp-flow";

export const metadata = { title: "Verificación en dos pasos" };

export default async function PartnerTwoFactorPage() {
  const pending = await getPendingPartner();
  if (!pending) redirect("/socios/login");
  const enrolled = Boolean(pending.totpEnabledAt);
  return enrolled ? (
    <PortalAuthShell title="Verifica tu identidad" description="Escribe el código que muestra tu app de verificación.">
      <TotpVerify />
    </PortalAuthShell>
  ) : (
    <PortalAuthShell title="Activa la verificación en dos pasos" description="Es un paso único para proteger tu cuenta.">
      <TotpSetup />
    </PortalAuthShell>
  );
}
