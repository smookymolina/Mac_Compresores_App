import Link from "next/link";
import { Lock } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordField } from "@/components/ui";
import { acceptInvitationAction } from "@/modules/auth/actions";
import { isInvitationValid } from "@/modules/auth/service";

// El token va en la URL: que no se filtre por la cabecera Referer.
export const metadata = { title: "Activar cuenta", referrer: "no-referrer" as const };

const back = <Link href="/login" className="auth-link">Ir a iniciar sesión</Link>;

export default async function InvitationPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && token.length <= 200 && (await isInvitationValid(token));
  if (!valid) {
    return (
      <AuthShell eyebrow="Invitación" title="Invitación no válida"
        description="El enlace de invitación ya se usó o venció. Pide al administrador del sistema que te la reenvíe." footer={back}>
        <Link href="/login" className="btn btn-primary w-full">Ir a iniciar sesión</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell eyebrow="Invitación" title="Activa tu cuenta" description="Elige la contraseña con la que entrarás al sistema." footer={back}>
      <ActionForm action={acceptInvitationAction} submitLabel="Activar mi cuenta" className="auth-fields">
        <input type="hidden" name="token" value={token} />
        <PasswordField label="Contraseña" name="password" autoComplete="new-password" minLength={10} hint="Mínimo 10 caracteres" required
          icon={<Lock size={16} strokeWidth={1.75} />} />
        <PasswordField label="Confirmar contraseña" name="confirm" autoComplete="new-password" minLength={10} required
          icon={<Lock size={16} strokeWidth={1.75} />} />
      </ActionForm>
    </AuthShell>
  );
}
