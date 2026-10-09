import Image from "next/image";
import { Boxes, FileText, Percent } from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { Gauge } from "./gauge";
import { Pipes } from "./pipes";

const HEADLINE = "Cotizaciones, ventas e inventario en un solo sistema.";
const TICKER = ["Precios del catálogo vigente", "Existencias por almacén", "Comisiones con reglas activas"];
const MODULES = [
  { icon: FileText, label: "Cotizaciones" },
  { icon: Boxes, label: "Inventario" },
  { icon: Percent, label: "Comisiones" },
];

function Readout() {
  return (
    <div className="readout" aria-hidden>
      <span className="readout-value" />
      <span className="readout-unit">PSI</span>
    </div>
  );
}

/**
 * Marco de las pantallas públicas (login, recuperar y restablecer contraseña).
 * Escritorio: panel de marca tipo sala de control + formulario. Móvil: banda de marca compacta y el
 * formulario como hoja que sube sobre ella. Toda la animación es decorativa y CSS (ver .auth-* en globals.css).
 */
export function AuthShell({ eyebrow, title, description, children, footer }: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <main className="auth">
      <aside className="sidebar auth-brand">
        <div aria-hidden className="auth-grid" />
        <Pipes className="auth-pipes" />

        <div className="auth-brand-top">
          <span className="logo-tile auth-logo">
            <Image src="/brand/logo-h.png" alt="MAC Compresores" width={150} height={40} priority className="h-9 w-auto lg:h-10" />
          </span>
          <span className="auth-status"><span aria-hidden className="auth-status-dot" /> Sistema en línea</span>
        </div>

        <div className="auth-copy">
          <p className="auth-headline" aria-label={HEADLINE}>
            {HEADLINE.split(" ").map((w, i) => (
              <span key={i} aria-hidden className="auth-word" style={{ "--i": i } as React.CSSProperties}>{w}{" "}</span>
            ))}
          </p>
          <div className="auth-ticker">
            <ul aria-hidden className="auth-ticker-track">
              {[...TICKER, TICKER[0]].map((t, i) => <li key={i}>{t}</li>)}
            </ul>
            <p className="sr-only">{TICKER.join(". ")}.</p>
          </div>
          <ul className="auth-modules">
            {MODULES.map(({ icon: Icon, label }, i) => (
              <li key={label} style={{ "--i": i } as React.CSSProperties}>
                <Icon size={18} strokeWidth={1.75} aria-hidden /> {label}
              </li>
            ))}
          </ul>
        </div>

        <div aria-hidden className="auth-instrument">
          <Gauge className="auth-gauge" />
          <Readout />
        </div>
      </aside>

      <div className="auth-panel">
        <div className="auth-sheet">
          <div className="auth-form login-form">
            <p className="auth-eyebrow">{eyebrow}</p>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
              <p className="mt-1 text-sm text-ink-soft">{description}</p>
            </div>
            <div>{children}</div>
            {footer && <div className="text-sm">{footer}</div>}
            <p className="auth-legal">Sistema interno · acceso solo para personal autorizado · v{APP_VERSION}</p>
          </div>
        </div>
      </div>
    </main>
  );
}
