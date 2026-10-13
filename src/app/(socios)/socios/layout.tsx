import type { Metadata } from "next";

// El <html> lo aporta el layout raíz; aquí solo se marca el portal (noindex) y se evita cualquier caché estática.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Portal de socios", robots: { index: false, follow: false, nocache: true } };

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <div className="portal">{children}</div>;
}
