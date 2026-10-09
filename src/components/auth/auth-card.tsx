import Image from "next/image";
import Link from "next/link";
import { APP_VERSION } from "@/lib/version";

/** Marco de las pantallas públicas de cuenta (recuperar/restablecer contraseña). */
export function AuthCard({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-panel p-4 sm:p-8">
      <div className="login-rise w-full max-w-sm">
        <span className="logo-tile mb-8 inline-flex">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-10 w-auto" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-ink-soft">{description}</p>
        <div className="mt-6">{children}</div>
        <p className="mt-6 text-sm"><Link href="/login" className="font-medium text-accent-fg hover:underline">Volver a iniciar sesión</Link></p>
        <p className="mt-8 text-xs text-muted">Sistema interno · acceso solo para personal autorizado · v{APP_VERSION}</p>
      </div>
    </main>
  );
}
