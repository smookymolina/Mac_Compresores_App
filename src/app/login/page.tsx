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
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm p-6">
        <Image src="/brand/logo-h.png" alt="MAC Compresores" width={220} height={59} priority className="mx-auto mb-6 h-auto" />
        <ActionForm action={loginAction} submitLabel="Entrar">
          <Field label="Correo" name="email" type="email" autoComplete="username" required />
          <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
        </ActionForm>
      </Card>
    </main>
  );
}
