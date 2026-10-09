import { Gauge } from "@/components/auth/gauge";

// Tubería horizontal para la banda de cabecera (lienzo 640×140). Mismas clases que las pantallas de acceso.
const PIPES = [
  "M650 34 H430 Q410 34 410 54 V96 Q410 116 390 116 H120",
  "M650 82 H520 Q500 82 500 102 V150",
  "M300 -10 V30 Q300 50 280 50 H-10",
];
const NODES: [number, number][] = [[410, 54], [500, 102], [300, 30]];

/** Decoración de la banda de cabecera: tubería con aire en circulación y, opcionalmente, el manómetro. */
export function PageDecor({ gauge }: { gauge?: boolean }) {
  return (
    <div aria-hidden className="page-decor">
      <svg viewBox="0 0 640 140" preserveAspectRatio="xMaxYMid slice" className="page-pipes">
        {PIPES.map((d, i) => <path key={`p${i}`} d={d} pathLength={1} className="pipe" />)}
        {PIPES.map((d, i) => <path key={`f${i}`} d={d} className="pipe-flow" style={{ "--n": i } as React.CSSProperties} />)}
        {NODES.map(([x, y], i) => (
          <g key={`n${i}`} style={{ "--n": i } as React.CSSProperties}>
            <circle cx={x} cy={y} r={6} className="pipe-node-ring" />
            <circle cx={x} cy={y} r={2.5} className="pipe-node-core" />
          </g>
        ))}
      </svg>
      {gauge && <Gauge className="page-gauge" />}
    </div>
  );
}
