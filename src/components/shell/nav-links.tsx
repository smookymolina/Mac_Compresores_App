"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BadgePercent, Boxes, ClipboardList, FileText, LayoutDashboard, Package, Receipt, ShieldCheck, Users, UserCog,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  dashboard: LayoutDashboard,
  quotes: FileText,
  sales: Receipt,
  customers: Users,
  products: Package,
  inventory: Boxes,
  commissions: BadgePercent,
  users: UserCog,
  audit: ShieldCheck,
  default: ClipboardList,
} as const;

export interface NavItem {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Encabezado de grupo; "" = sin encabezado. */
  group: string;
}

/**
 * `sidebar`: etiquetas ocultas en tablet (icon-only) y visibles en ≥xl salvo colapsado manual.
 * `drawer`: siempre con etiquetas (móvil).
 */
export function NavLinks({
  items, mode, collapsed = false, onNavigate,
}: {
  items: NavItem[];
  mode: "sidebar" | "drawer";
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const path = usePathname();
  // Icon-only: la etiqueta sigue en el DOM (nombre accesible) pero fuera de la vista.
  const hideLabel = mode === "sidebar" ? (collapsed ? "md:sr-only" : "md:sr-only xl:not-sr-only") : "";
  const groups = [...new Set(items.map((i) => i.group))];

  return (
    <nav aria-label="Principal" className="space-y-4 px-2 py-3">
      {groups.map((g, gi) => (
        <div key={g || gi}>
          {g && (
            <>
              <p className={cn("mb-1 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted", mode === "sidebar" && (collapsed ? "md:hidden" : "md:hidden xl:block"))}>{g}</p>
              {mode === "sidebar" && <hr className={cn("mx-2 mb-2 border-line", collapsed ? "md:block" : "md:block xl:hidden")} />}
            </>
          )}
          <ul className="space-y-0.5">
            {items.filter((i) => i.group === g).map((i) => {
              const Icon = ICONS[i.icon] ?? ICONS.default;
              const active = path === i.href || path.startsWith(i.href + "/");
              return (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={active ? "page" : undefined}
                    title={mode === "sidebar" ? i.label : undefined}
                    onClick={onNavigate}
                    className={cn(
                      "relative flex h-9 items-center gap-3 rounded-md px-2.5 text-sm font-medium transition-colors",
                      active ? "bg-accent-soft text-accent-fg" : "text-ink-soft hover:bg-panel-2 hover:text-ink",
                    )}
                  >
                    <Icon size={18} strokeWidth={1.75} aria-hidden className="shrink-0" />
                    <span className={cn("truncate", hideLabel)}>{i.label}</span>
                    {active && <span aria-hidden className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-accent-fg" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
