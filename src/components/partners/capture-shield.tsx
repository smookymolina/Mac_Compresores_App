"use client";

import { createContext, useContext } from "react";
import { useCaptureShield } from "./use-capture-shield";

/** GIF transparente 1x1: sustituye el `src` de los PNG de precio mientras el escudo está activo. */
export const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const ShieldContext = createContext(false);

/** ¿Está difuminado? Úsalo en `PriceImg`: `src={shieldSrc(src, useShieldHidden())}`. */
export function useShieldHidden(): boolean {
  return useContext(ShieldContext);
}

export function shieldSrc(src: string, hidden: boolean): string {
  return hidden ? TRANSPARENT_PIXEL : src;
}

// Texto fijo (sin entrada del usuario). Solo existe mientras el escudo está montado.
const SHIELD_CSS = `
.shield-target{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.shield-target :where(input,textarea){-webkit-user-select:text;user-select:text}
.shield-target img{-webkit-user-drag:none;pointer-events:none}
.shield-target[data-hidden="true"]{filter:blur(16px) saturate(.6);pointer-events:none}
@media print{body{display:none!important}}
`;

/**
 * Envuelve la zona de resultados (`<main class="shield-target">`). Al difuminarse muestra un overlay sólido
 * (el contenido de atrás queda `inert`: ni Tab ni lector llegan a él) y cambia el contexto: las <img> de precio deben leer `useShieldHidden()` para soltar su `src`.
 * `onReveal` permite refrescar la búsqueda (las URLs firmadas vencen a los 60 s).
 */
export function CaptureShield({
  children,
  onReveal,
  className,
  id,
  message = "Toca para mostrar precios",
  hint = "Ocultamos los precios al salir de esta pantalla para protegerlos.",
}: {
  children: React.ReactNode;
  onReveal?: () => void;
  className?: string;
  id?: string;
  message?: string;
  hint?: string;
}) {
  const { hidden, reveal } = useCaptureShield({ onReveal });
  return (
    <ShieldContext.Provider value={hidden}>
      <style>{SHIELD_CSS}</style>
      <main id={id} className={`shield-target${className ? ` ${className}` : ""}`} data-hidden={hidden ? "true" : "false"} inert={hidden}>
        {children}
      </main>
      {hidden && (
        <div className="shield-overlay" style={{ position: "fixed", inset: 0, zIndex: 40, display: "grid", placeItems: "center", padding: "1rem", background: "color-mix(in oklab, var(--bg, #fff) 55%, transparent)" }}>
          <div role="dialog" aria-modal="true" aria-label={message} className="card" style={{ maxWidth: 360, padding: "1.25rem", textAlign: "center", background: "var(--panel, #fff)" }}>
            <p style={{ margin: "0 0 .75rem" }}>{hint}</p>
            <button type="button" className="btn btn-primary" autoFocus onClick={reveal}>
              {message}
            </button>
          </div>
        </div>
      )}
    </ShieldContext.Provider>
  );
}
