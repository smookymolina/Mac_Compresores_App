import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { loginAction } from "@/modules/auth/actions";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="sidebar hidden flex-col justify-between p-10 lg:flex">
        <span className="logo-tile self-start">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-10 w-auto" />
        </span>
        <div className="max-w-sm">
          <p className="text-2xl font-semibold leading-tight tracking-tight">Cotizaciones, ventas e inventario en un solo sistema.</p>
          <p className="mt-3 text-sm text-ink-soft">Precios del catálogo, existencias por almacén y comisiones calculadas con las reglas vigentes.</p>
        </div>
        <p className="text-xs text-muted">Sistema interno · acceso solo para personal autorizado</p>
      </aside>
      <div className="grid place-items-center bg-panel p-4 sm:p-8">
        <div className="page-enter w-full max-w-sm">
          <span className="logo-tile mb-8 inline-flex lg:hidden">
            <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-10 w-auto" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Iniciar sesión</h1>
          <p className="mb-6 mt-1 text-sm text-ink-soft">Accede con tu cuenta del sistema.</p>
          <ActionForm action={loginAction} submitLabel="Entrar" className="space-y-4 [&_.btn]:w-full">
            <Field label="Correo" name="email" type="email" autoComplete="username" spellCheck={false} required />
            <Field label="Contraseña" name="password" type="password" autoComplete="current-password" required />
          </ActionForm>
          <p className="mt-8 text-xs text-muted lg:hidden">Sistema interno · MAC Compresores</p>
        </div>
      </div>
    </main>
  );
}
