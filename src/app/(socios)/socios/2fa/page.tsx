import { redirect } from "next/navigation";
import { getPendingPartner } from "@/modules/partners/session";
import { PortalAuthShell } from "@/components/socios/portal-auth-shell";
import { TotpVerify } from "@/components/socios/totp-flow";
import { EmailCodeForm } from "@/components/socios/email-code-form";

export const metadata = { title: "Verifica tu acceso" };

export default async function PartnerTwoFactorPage() {
  const pending = await getPendingPartner();
  if (!pending) redirect("/socios/login");
  const enrolled = Boolean(pending.totpEnabledAt);
  return enrolled ? (
    <PortalAuthShell title="Verifica tu identidad" description="Escribe el código que muestra tu app de verificación.">
      <TotpVerify />
    </PortalAuthShell>
  ) : (
    <PortalAuthShell title="Revisa tu correo" description="Un último paso para confirmar que eres tú.">
      <EmailCodeForm email={pending.email} />
    </PortalAuthShell>
  );
}
