import { ActionForm } from "@/components/action-form";
import { AuthCard } from "@/components/auth/auth-card";
import { Field } from "@/components/ui";
import { requestPasswordResetAction } from "@/modules/auth/actions";

export const metadata = { title: "Recuperar contraseña" };

export default function RecoverPage() {
  return (
    <AuthCard title="¿Olvidaste tu contraseña?" description="Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una nueva.">
      <ActionForm action={requestPasswordResetAction} submitLabel="Enviar enlace" resetOnSuccess className="space-y-4 [&_.btn]:w-full">
        <Field label="Correo" name="email" type="email" autoComplete="username" spellCheck={false} required />
      </ActionForm>
    </AuthCard>
  );
}
