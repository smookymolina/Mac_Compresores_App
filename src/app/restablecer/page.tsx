import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { AuthCard } from "@/components/auth/auth-card";
import { Field } from "@/components/ui";
import { resetPasswordAction } from "@/modules/auth/actions";
import { isResetTokenValid } from "@/modules/auth/service";

// El token va en la URL: que no se filtre por la cabecera Referer.
export const metadata = { title: "Restablecer contraseña", referrer: "no-referrer" as const };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  const valid = typeof token === "string" && token.length <= 200 && (await isResetTokenValid(token));
  if (!valid) {
    return (
      <AuthCard title="Enlace no válido" description="El enlace para restablecer la contraseña ya se usó o venció.">
        <Link href="/recuperar" className="btn btn-primary w-full">Solicitar un enlace nuevo</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Elige una nueva contraseña" description="Al guardarla se cerrarán las sesiones abiertas de tu cuenta.">
      <ActionForm action={resetPasswordAction} submitLabel="Guardar contraseña" className="space-y-4 [&_.btn]:w-full">
        <input type="hidden" name="token" value={token} />
        <Field label="Nueva contraseña" name="password" type="password" autoComplete="new-password" minLength={10} hint="Mínimo 10 caracteres" required />
        <Field label="Confirmar contraseña" name="confirm" type="password" autoComplete="new-password" minLength={10} required />
      </ActionForm>
    </AuthCard>
  );
}
