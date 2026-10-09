import Link from "next/link";
import { Mail } from "lucide-react";
import { ActionForm } from "@/components/action-form";
import { AuthShell } from "@/components/auth/auth-shell";
import { Field } from "@/components/ui";
import { requestPasswordResetAction } from "@/modules/auth/actions";

export const metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <AuthShell
      eyebrow="Recuperar acceso"
      title="¿Olvidaste tu contraseña?"
      description="Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una nueva."
      footer={<Link href="/login" className="auth-link">Volver a iniciar sesión</Link>}
    >
      <ActionForm action={requestPasswordResetAction} submitLabel="Enviar enlace" resetOnSuccess className="auth-fields">
        <Field label="Correo" name="email" type="email" autoComplete="username" spellCheck={false} required
          icon={<Mail size={16} strokeWidth={1.75} />} />
      </ActionForm>
    </AuthShell>
  );
}
