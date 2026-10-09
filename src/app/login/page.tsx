import Link from "next/link";
import { redirect } from "next/navigation";
import { Lock, Mail } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Field, PasswordField } from "@/components/ui";
import { loginAction } from "@/modules/auth/actions";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ restablecida?: string }> }) {
  const { restablecida } = await searchParams;
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <AuthShell
      eyebrow="Acceso al sistema"
      title="Iniciar sesión"
      description="Accede con tu cuenta del sistema."
      footer={<Link href="/recuperar" className="auth-link">¿Olvidaste tu contraseña?</Link>}
    >
      {restablecida && (
        <p role="status" className="auth-notice">Contraseña actualizada. Inicia sesión con la nueva.</p>
      )}
      <ActionForm action={loginAction} submitLabel="Entrar" className="auth-fields">
        <Field label="Correo" name="email" type="email" autoComplete="username" spellCheck={false} required
          icon={<Mail size={16} strokeWidth={1.75} />} placeholder="nombre@maccompresores.com.mx" />
        <PasswordField label="Contraseña" name="password" autoComplete="current-password" required
          icon={<Lock size={16} strokeWidth={1.75} />} />
      </ActionForm>
    </AuthShell>
  );
}
