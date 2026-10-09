// Red de tubería decorativa: tramos ortogonales con aire en circulación (trazo discontinuo que avanza)
// y uniones que laten. Solo SVG + CSS; con movimiento reducido queda estática.
// Coordenadas en un lienzo 400×600: los tramos rodean la zona del texto (x < 240, y 100–340).
const PIPES = [
  "M-10 75 H300 Q320 75 320 95 V200 Q320 220 340 220 H410",
  "M410 130 H380 Q360 130 360 150 V380 Q360 400 340 400 H280",
  "M260 610 V320 Q260 300 280 300 H410",
  "M-10 380 H120 Q140 380 140 400 V610",
  "M-10 470 H40 Q60 470 60 490 V610",
  "M140 440 H220 Q240 440 240 460 V610",
];
const NODES: [number, number][] = [[320, 95], [360, 150], [260, 320], [140, 400], [60, 490], [240, 460]];

export function Pipes({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" aria-hidden className={className}>
      {PIPES.map((d, i) => <path key={`p${i}`} d={d} pathLength={1} className="pipe" />)}
      {PIPES.map((d, i) => <path key={`f${i}`} d={d} className="pipe-flow" style={{ "--n": i } as React.CSSProperties} />)}
      {NODES.map(([x, y], i) => (
        <g key={`n${i}`} className="pipe-node" style={{ "--n": i } as React.CSSProperties}>
          <circle cx={x} cy={y} r={7} className="pipe-node-ring" />
          <circle cx={x} cy={y} r={3} className="pipe-node-core" />
        </g>
      ))}
    </svg>
  );
}
