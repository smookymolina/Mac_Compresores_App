import Image from "next/image";

/** Marco de /socios/login y /socios/2fa: sin buscador, sin marca de agua ni escudo (el socio debe poder copiar sus códigos). */
export function PortalAuthShell({ title, description, children, footer }: {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main id="contenido" className="portal-auth">
      <div className="portal-auth-card">
        <span className="logo-tile mb-5">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-9 w-auto" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-soft">{description}</p>}
        <div className="mt-5">{children}</div>
        {footer && <div className="mt-4 text-sm">{footer}</div>}
      </div>
    </main>
  );
}
