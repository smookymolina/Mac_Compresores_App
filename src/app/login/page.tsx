import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { Card, Field } from "@/components/ui";
import { loginAction } from "@/modules/auth/actions";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh place-items-center bg-surface p-4">
      <div className="page-enter w-full max-w-sm">
        <div className="mb-6 flex justify-center"><span className="logo-tile">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-10 w-auto" />
        </span></div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold tracking-tight">Iniciar sesión</h1>
          <p className="mb-5 mt-1 text-sm text-ink-soft">Accede con tu cuenta del sistema.</p>
          <ActionForm action={loginAction} submitLabel="Entrar" className="[&_.btn]:w-full">
            <Field label="Correo" name="email" type="email" autoComplete="username" required />
            <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
          </ActionForm>
        </Card>
        <p className="mt-4 text-center text-xs text-muted">Sistema interno · MAC Compresores</p>
      </div>
    </main>
  );
}
