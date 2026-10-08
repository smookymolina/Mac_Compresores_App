import Image from "next/image";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { ActionForm } from "@/components/action-form";
import { ExternalLink, Info } from "lucide-react";
import { Field, PasswordField } from "@/components/ui";
import { loginAction } from "@/modules/auth/actions";
import { Gauge } from "./gauge";

export const metadata = { title: "Iniciar sesión" };

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="grid min-h-dvh bg-surface lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="sidebar login-brand hidden flex-col gap-24 p-10 lg:flex">
        <div aria-hidden className="login-flow">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="flow-line" style={{ "--n": i } as React.CSSProperties} />)}
        </div>
        <Gauge className="login-gauge" />
        <span className="logo-tile page-enter relative self-start">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-10 w-auto" />
        </span>
        <div className="login-rise relative max-w-sm">
          <p className="text-2xl font-semibold leading-tight tracking-tight">Cotizaciones, ventas e inventario en un solo sistema.</p>
          <p className="mt-3 text-sm text-ink-soft">Precios del catálogo, existencias por almacén y comisiones calculadas con las reglas vigentes.</p>
        </div>
      </aside>
      <div className="login-pane flex flex-col bg-panel">
        <div className="relative flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <span className="logo-tile lg:invisible">
            <Image src="/brand/logo-h.png" alt="MAC Compresores" width={120} height={32} priority className="h-8 w-auto" />
          </span>
          <a href="https://maccompresores.com.mx" target="_blank" rel="noopener" className="login-link inline-flex items-center gap-1.5 text-sm">
            maccompresores.com.mx <ExternalLink size={14} strokeWidth={1.75} aria-hidden />
          </a>
        </div>
        <div className="relative grid flex-1 place-items-center px-4 pb-10 sm:px-8">
          <div className="login-rise login-form login-card w-full max-w-[25rem]">
            <div>
              <p className="text-sm font-medium text-accent-fg">Bienvenido</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">Iniciar sesión</h1>
              <p className="mt-1 text-sm text-ink-soft">Accede con tu cuenta del sistema.</p>
            </div>
            <ActionForm action={loginAction} submitLabel="Entrar" className="mt-6 space-y-4 [&_.btn]:w-full">
              <Field label="Correo" name="email" type="email" autoComplete="username" spellCheck={false} placeholder="nombre@empresa.com" required />
              <PasswordField label="Contraseña" name="password" autoComplete="current-password" required />
              <details className="login-forgot">
                <summary>¿Olvidaste tu contraseña?</summary>
                <p>
                  <Info size={15} strokeWidth={1.75} aria-hidden className="mt-0.5 shrink-0 text-accent-fg" />
                  <span>La recuperación por correo aún no está disponible. Pide al administrador que restablezca tu contraseña desde <b>Usuarios</b>.</span>
                </p>
              </details>
            </ActionForm>
          </div>
        </div>
        <p className="relative px-6 pb-6 text-center text-xs text-muted sm:px-10">Sistema interno · acceso solo para personal autorizado</p>
      </div>
    </main>
  );
}
