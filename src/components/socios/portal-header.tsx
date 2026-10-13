import Image from "next/image";
import { LogOut } from "lucide-react";
import { partnerLogoutAction } from "@/modules/partners/portal-actions";

/** Encabezado del portal: logo, nombre · empresa y cierre de sesión. Fuera de la zona protegida (siempre accesible). */
export function PortalHeader({ name, company }: { name: string; company: string }) {
  return (
    <header className="portal-head">
      <div className="portal-head-in">
        <span className="logo-tile shrink-0">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-8 w-auto" />
        </span>
        <p className="portal-who text-sm">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-xs text-muted">{company}</span>
        </p>
        <form action={partnerLogoutAction}>
          <button type="submit" className="btn btn-ghost gap-2">
            <LogOut size={16} strokeWidth={1.75} aria-hidden /> <span>Cerrar sesión</span>
          </button>
        </form>
      </div>
    </header>
  );
}
