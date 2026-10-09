import Link from "next/link";
import { Lock } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { PasswordField } from "@/components/ui";
import { resetPasswordAction } from "@/modules/auth/actions";
import { isResetTokenValid } from "@/modules/auth/service";

// El token va en la URL: que no se filtre por la cabecera Referer.
export const metadata = { title: "Restablecer contraseña", referrer: "no-referrer" as const };

const back = <Link href="/login" className="auth-link">Volver a iniciar sesión</Link>;

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && token.length <= 200 && (await isResetTokenValid(token));
  if (!valid) {
    return (
      <AuthShell eyebrow="Recuperar acceso" title="Enlace no válido" description="El enlace para restablecer la contraseña ya se usó o venció." footer={back}>
        <Link href="/recuperar" className="btn btn-primary w-full">Solicitar un enlace nuevo</Link>
      </AuthShell>
    );
  }
  return (
    <AuthShell eyebrow="Recuperar acceso" title="Elige una nueva contraseña" description="Al guardarla se cerrarán las sesiones abiertas de tu cuenta." footer={back}>
      <ActionForm action={resetPasswordAction} submitLabel="Guardar contraseña" className="auth-fields">
        <input type="hidden" name="token" value={token} />
        <PasswordField label="Nueva contraseña" name="password" autoComplete="new-password" minLength={10} hint="Mínimo 10 caracteres" required
          icon={<Lock size={16} strokeWidth={1.75} />} />
        <PasswordField label="Confirmar contraseña" name="confirm" autoComplete="new-password" minLength={10} required
          icon={<Lock size={16} strokeWidth={1.75} />} />
      </ActionForm>
    </AuthShell>
  );
}
