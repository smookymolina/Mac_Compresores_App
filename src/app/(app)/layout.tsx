import Image from "next/image";
import { requireUser } from "@/lib/auth/session";
import type { Permission } from "@/lib/auth/permissions";
import { logoutAction } from "@/modules/auth/actions";
import { NavLinks, type NavItem } from "./nav-links";

const NAV: (NavItem & { anyOf: Permission[] })[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", anyOf: ["dashboard.read"] },
  { href: "/cotizaciones", label: "Cotizaciones", icon: "quotes", anyOf: ["quotes.read_all", "quotes.read_own"] },
  { href: "/ventas", label: "Ventas", icon: "sales", anyOf: ["sales.read_all", "sales.read_own"] },
  { href: "/clientes", label: "Clientes", icon: "customers", anyOf: ["customers.read"] },
  { href: "/productos", label: "Productos y precios", icon: "products", anyOf: ["products.read"] },
  { href: "/inventario", label: "Inventario", icon: "inventory", anyOf: ["inventory.read"] },
  { href: "/comisiones", label: "Comisiones", icon: "commissions", anyOf: ["commissions.read_all", "commissions.read_own"] },
  { href: "/usuarios", label: "Usuarios", icon: "users", anyOf: ["users.manage"] },
  { href: "/auditoria", label: "Auditoría", icon: "audit", anyOf: ["audit.read"] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const items = NAV.filter((n) => n.anyOf.some((p) => user.permissions.has(p))).map(({ href, label, icon }) => ({ href, label, icon }));

  return (
    <div className="min-h-screen md:flex">
      <aside className="border-b border-line bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-4 py-3 md:block md:py-5">
          <Image src="/brand/logo-h.png" alt="MAC Compresores" width={160} height={43} className="h-auto" priority />
        </div>
        <NavLinks items={items} />
        <div className="hidden border-t border-line p-4 text-xs md:absolute md:bottom-0 md:block md:w-full">
          <p className="font-medium text-ink">{user.name}</p>
          <p className="text-ink-soft">{user.roleName}</p>
          <form action={logoutAction} className="mt-2">
            <button className="text-brand hover:underline">Cerrar sesión</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="mb-3 flex justify-end text-xs md:hidden">
          <form action={logoutAction}>
            <button className="text-brand">Cerrar sesión ({user.name})</button>
          </form>
        </div>
        {children}
      </main>
    </div>
  );
}
