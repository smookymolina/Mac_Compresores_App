// Manómetro decorativo del panel de marca: escala de 270° y aguja que barre una vez al cargar.
// Solo transform/opacity (ver .gauge-* en globals.css); con movimiento reducido queda en su posición final.
const CX = 100;
const CY = 100;
const START = 135; // grados SVG (0 = derecha, sentido horario)
const SWEEP = 270;
const TICKS = 28;
const LIT = 16; // marcas que la aguja alcanza (≈ 62 % de la escala)

function polar(r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return { x: +(CX + r * Math.cos(a)).toFixed(2), y: +(CY + r * Math.sin(a)).toFixed(2) };
}

function arc(r: number, from: number, to: number) {
  const a = polar(r, from);
  const b = polar(r, to);
  return `M${a.x} ${a.y} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${b.x} ${b.y}`;
}

export function Gauge({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 200" aria-hidden className={className}>
      <path d={arc(84, START, START + SWEEP)} className="gauge-track" />
      {/* Rango de operación: la aguja termina al inicio de la zona. */}
      <path d={arc(84, START + SWEEP * 0.58, START + SWEEP * 0.8)} className="gauge-zone" />
      {Array.from({ length: TICKS }, (_, i) => {
        const deg = START + (SWEEP / (TICKS - 1)) * i;
        const major = i % 3 === 0;
        const a = polar(major ? 66 : 70, deg);
        const b = polar(76, deg);
        return (
          <line
            key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
            className={`gauge-tick${major ? " gauge-tick-major" : ""}${i <= LIT ? " gauge-tick-lit" : ""}`}
            style={{ "--i": i } as React.CSSProperties}
          />
        );
      })}
      <g className="gauge-needle">
        {/* Grupo interior: oscilación leve en reposo, separada del barrido inicial. */}
        <g className="gauge-needle-idle">
          <line x1={CX} y1={CY + 12} x2={CX} y2={CY - 60} />
        </g>
      </g>
      <circle cx={CX} cy={CY} r={6} className="gauge-hub" />
    </svg>
  );
}
