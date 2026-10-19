import { LogOut } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import { logoutAction } from "@/modules/auth/actions";
import { userHasMobileAccess } from "@/modules/sync/app-download";
import { AppShell } from "@/components/shell/app-shell";
import type { NavItem } from "@/components/shell/nav-links";

const NAV: (NavItem & { anyOf: Permission[] })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "", anyOf: ["dashboard.read"] },
  { href: "/cotizaciones", label: "Cotizaciones", icon: "quotes", group: "Comercial", anyOf: ["quotes.read_all", "quotes.read_own"] },
  { href: "/ventas", label: "Ventas", icon: "sales", group: "Comercial", anyOf: ["sales.read_all", "sales.read_own"] },
  { href: "/cobranza", label: "Cobranza", icon: "receivables", group: "Comercial", anyOf: ["sales.read_all", "sales.read_own"] },
  { href: "/clientes", label: "Clientes", icon: "customers", group: "Comercial", anyOf: ["customers.read"] },
  { href: "/productos", label: "Productos y precios", icon: "products", group: "Catálogo y almacén", anyOf: ["products.read"] },
  { href: "/inventario", label: "Inventario", icon: "inventory", group: "Catálogo y almacén", anyOf: ["inventory.read"] },
  { href: "/comisiones", label: "Comisiones", icon: "commissions", group: "Gestión", anyOf: ["commissions.read_all", "commissions.read_own"] },
  { href: "/usuarios", label: "Usuarios", icon: "users", group: "Gestión", anyOf: ["users.manage"] },
  { href: "/sincronizacion", label: "Sincronización", icon: "sync", group: "Gestión", anyOf: ["users.manage"] },
  { href: "/socios-admin", label: "Socios", icon: "partners", group: "Gestión", anyOf: ["partners.manage"] },
  { href: "/reportes", label: "Reportes", icon: "reports", group: "Gestión", anyOf: ["reports.export"] },
  { href: "/auditoria", label: "Auditoría", icon: "audit", group: "Gestión", anyOf: ["audit.read"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items: NavItem[] = NAV.filter((n) => n.anyOf.some((p) => user.permissions.has(p))).map(({ href, label, icon, group }) => ({ href, label, icon, group }));
  // Descarga de la app móvil: solo para quien tiene el acceso móvil activado.
  if (await userHasMobileAccess(user.id)) items.push({ href: "/app", label: "App móvil", icon: "app", group: "" });

  return (
    <AppShell
      nav={items}
      user={{ name: user.name, roleName: user.roleName }}
      logout={
        <form action={logoutAction}>
          <button className="btn btn-ghost w-full justify-start gap-2 text-ink-soft">
            <LogOut size={16} strokeWidth={1.75} aria-hidden /> Cerrar sesión
          </button>
        </form>
      }
    >
      {children}
    </AppShell>
  );
}
