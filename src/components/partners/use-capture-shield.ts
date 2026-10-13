"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { reportSuspiciousAction } from "@/modules/partners/shield-actions";

type ShieldEvent = "HIDDEN" | "PRINT_ATTEMPT" | "COPY_ATTEMPT" | "CAPTURE_KEY" | "DEVTOOLS" | "WEBDRIVER";

const THROTTLE_MS = 15_000; // por tipo
const MAX_REPORTS = 30; // por carga de página (tope duro contra bucles)
const DEVTOOLS_GAP = 160;

function isEditable(t: EventTarget | null): boolean {
  return t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
}

function isCaptureCombo(e: KeyboardEvent): boolean {
  if (e.key === "PrintScreen" || e.code === "PrintScreen") return true;
  if (e.metaKey && e.shiftKey && (e.code === "Digit3" || e.code === "Digit4" || e.code === "Digit5")) return true; // macOS
  if (e.metaKey && e.shiftKey && e.code === "KeyS") return true; // Win+Shift+S
  return false;
}

/**
 * Difuminado inmediato + bloqueo de copia/impresión + detección de automatización y devtools.
 * `hidden` queda en true hasta que el usuario llama `reveal()` (toque o clic): recuperar el foco no basta.
 * Los reportes al servidor tienen throttle por tipo y un tope por carga de página.
 */
export function useCaptureShield(opts: { enabled?: boolean; onReveal?: () => void } = {}) {
  const { enabled = true, onReveal } = opts;
  const [hidden, setHidden] = useState(false);
  const last = useRef<Partial<Record<ShieldEvent, number>>>({});
  const sent = useRef(0);
  const onRevealRef = useRef(onReveal);
  useEffect(() => {
    onRevealRef.current = onReveal;
  });

  const reveal = useCallback(() => {
    setHidden(false);
    onRevealRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const report = (type: ShieldEvent, meta?: Record<string, string | number | boolean>) => {
      const now = Date.now();
      if (sent.current >= MAX_REPORTS || now - (last.current[type] ?? 0) < THROTTLE_MS) return;
      last.current[type] = now;
      sent.current += 1;
      void reportSuspiciousAction(type, meta).catch(() => {});
    };
    const hide = () => setHidden(true);

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hide();
        report("HIDDEN", { via: "visibilitychange" });
      }
    };
    const onBlur = () => hide();
    const onPageHide = () => {
      hide();
      report("HIDDEN", { via: "pagehide" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (isCaptureCombo(e)) {
        hide();
        report("CAPTURE_KEY", { key: e.code || e.key });
        if (e.key === "PrintScreen" && e.type === "keyup") void navigator.clipboard?.writeText("").catch(() => {});
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P") && e.type === "keydown") {
        e.preventDefault();
        hide();
        report("PRINT_ATTEMPT", { via: "shortcut" });
      }
    };
    const onBeforePrint = () => {
      hide();
      report("PRINT_ATTEMPT", { via: "beforeprint" });
    };
    const block = (e: Event) => {
      if (isEditable(e.target)) return; // el buscador sigue siendo editable
      e.preventDefault();
      if (e.type === "copy" || e.type === "cut") report("COPY_ATTEMPT", { via: e.type });
    };
    const blockMenu = (e: Event) => {
      if (!isEditable(e.target)) e.preventDefault();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKey, true);
    window.addEventListener("beforeprint", onBeforePrint);
    document.addEventListener("contextmenu", blockMenu);
    for (const t of ["copy", "cut", "selectstart", "dragstart"]) document.addEventListener(t, block);

    // Automatización: el servidor decide el bloqueo.
    if (navigator.webdriver) report("WEBDRIVER", { ua: navigator.userAgent.slice(0, 60) });

    // Devtools acoplados: diferencia ventana externa/interna. En móvil no aplica (outer == inner).
    let devtoolsOpen = false;
    const check = () => {
      const open = window.outerWidth - window.innerWidth > DEVTOOLS_GAP || window.outerHeight - window.innerHeight > DEVTOOLS_GAP;
      if (open && !devtoolsOpen) report("DEVTOOLS");
      devtoolsOpen = open;
    };
    const timer = window.setInterval(check, 3000);
    check();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKey, true);
      window.removeEventListener("beforeprint", onBeforePrint);
      document.removeEventListener("contextmenu", blockMenu);
      for (const t of ["copy", "cut", "selectstart", "dragstart"]) document.removeEventListener(t, block);
      window.clearInterval(timer);
    };
  }, [enabled]);

  return { hidden, reveal };
}
