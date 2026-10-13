import Link from "next/link";
import { findInvite } from "@/modules/partners/invite";
import { PortalAuthShell } from "@/components/socios/portal-auth-shell";
import { ActivateForm } from "@/components/socios/activate-form";
import { ContactLine, PORTAL_CONTACT } from "@/components/socios/contact";

export const metadata = { title: "Crea tu contraseña" };

export default async function PartnerActivatePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const invite = await findInvite(t);
  if (!invite)
    return (
      <PortalAuthShell title="El enlace ya no es válido" description="Venció o ya se usó.">
        <div role="alert" className="portal-error">
          <p>Pide un enlace nuevo a MAC Compresores. Si ya creaste tu contraseña, inicia sesión.</p>
          <ContactLine contact={PORTAL_CONTACT} />
          <p className="mt-2"><Link className="auth-link" href="/socios/login">Iniciar sesión</Link></p>
        </div>
      </PortalAuthShell>
    );
  return (
    <PortalAuthShell title={`Hola, ${invite.name}`} description="Crea tu contraseña para entrar al portal de socios.">
      <ActivateForm token={t} email={invite.email} />
    </PortalAuthShell>
  );
}
