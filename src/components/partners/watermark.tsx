"use client";

import { useEffect, useRef } from "react";

const TILE_W = 260;
const TILE_H = 130;
const ANGLE = (-28 * Math.PI) / 180;

function mxStamp(d = new Date()): string {
  // dd/mm/aaaa HH:mm en hora de Ciudad de México
  const parts = new Intl.DateTimeFormat("es-MX", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

/**
 * Marca de agua en <canvas> fijo sobre los resultados (no es DOM, no se borra con un selector de texto).
 * Línea 1: "nombre · ID corto". Línea 2: "fecha hora MX · IP". Se redibuja con resize y cada 60 s.
 * Doble pasada (trazo oscuro + relleno claro) para que sea visible sobre fondo claro u oscuro.
 * No se monta en /socios/login ni /socios/2fa.
 */
export function Watermark({ name, shortId, ip }: { name: string; shortId: string; ip: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.font = '600 13px "IBM Plex Mono", ui-monospace, monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(15,23,42,0.18)";
      ctx.fillStyle = "rgba(255,255,255,0.12)";

      const lines = [`${name} · ID ${shortId}`, `${mxStamp()} · ${ip}`];
      const reach = Math.hypot(w, h);

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(ANGLE);
      let row = 0;
      for (let y = -reach / 2; y <= reach / 2 + TILE_H; y += TILE_H, row++) {
        const shift = row % 2 ? TILE_W / 2 : 0; // fila alterna desplazada medio mosaico
        for (let x = -reach / 2 - TILE_W; x <= reach / 2 + TILE_W; x += TILE_W) {
          for (const [i, line] of lines.entries()) {
            const cy = y + 56 + i * 18;
            ctx.strokeText(line, x + shift, cy);
            ctx.fillText(line, x + shift, cy);
          }
        }
      }
      ctx.restore();
    };

    draw();
    const timer = window.setInterval(draw, 60_000);
    window.addEventListener("resize", draw);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", draw);
    };
  }, [name, shortId, ip]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      style={{ position: "fixed", inset: 0, width: "100vw", height: "100dvh", pointerEvents: "none", zIndex: 30 }}
    />
  );
}
