import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/modules/partners/session";
import { PortalAuthShell } from "@/components/socios/portal-auth-shell";
import { LoginForm } from "@/components/socios/login-form";

export const metadata = { title: "Iniciar sesión" };

const NOTICES: Record<string, string> = {
  inactividad: "Tu sesión terminó por inactividad. Inicia sesión de nuevo.",
  otro: "Se abrió tu cuenta en otro dispositivo. Inicia sesión de nuevo si fuiste tú.",
};

export default async function PartnerLoginPage({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  if (await getCurrentPartner()) redirect("/socios");
  const { motivo } = await searchParams;
  const notice = motivo ? NOTICES[motivo] : undefined;
  return (
    <PortalAuthShell title="Inicia sesión" description="Consulta tus precios de socio de MAC Compresores.">
      {notice && <p role="status" className="auth-notice">{notice}</p>}
      <LoginForm />
    </PortalAuthShell>
  );
}
