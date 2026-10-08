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
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:pb-0">
      {items.map((i) => {
        const Icon = ICONS[i.icon] ?? ICONS.default;
        const active = path === i.href || path.startsWith(i.href + "/");
        return (
          <Link
            key={i.href}
            href={i.href}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm",
              active ? "bg-brand text-white" : "text-ink-soft hover:bg-surface hover:text-ink",
            )}
          >
            <Icon size={16} aria-hidden /> {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
