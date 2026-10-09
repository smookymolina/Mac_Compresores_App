import { fmtMoney, type Dec } from "@/lib/money";

/**
 * Barras de una sola serie por mes (magnitud en el tiempo): un solo tono, sin leyenda (el título nombra la serie),
 * eje recesivo, etiqueta directa solo en el mes actual y tooltip por columna (zona de toque = columna completa).
 * Incluye vista de tabla para lectores de pantalla y para consultar las cifras exactas.
 */
export function MonthBars({ data, caption }: { data: { key: string; label: string; year: number; net: Dec }[]; caption: string }) {
  const max = Math.max(...data.map((d) => d.net.toNumber()), 0);
  const top = niceMax(max);
  const last = data.length - 1;
  return (
    <figure className="month-bars">
      <div className="mb-plot" aria-hidden>
        <div className="mb-grid">
          <span style={{ bottom: "100%" }}>{compact(top)}</span>
          <span style={{ bottom: "50%" }}>{compact(top / 2)}</span>
          <span style={{ bottom: 0 }}>0</span>
        </div>
        <div className="mb-cols">
          {data.map((d, i) => {
            const pct = top > 0 ? (d.net.toNumber() / top) * 100 : 0;
            const tip = `${d.label} ${d.year}: ${fmtMoney(d.net)}`;
            return (
              <div key={d.key} className="mb-col" tabIndex={0} data-tip={tip} data-tip-start={i < 3 ? "" : undefined} aria-label={tip}>
                {i === last && d.net.gt(0) && <span className="mb-value" style={{ bottom: `${pct}%` }}>{compact(d.net.toNumber())}</span>}
                <span className={`mb-bar${i === last ? " is-current" : ""}`} style={{ height: `${Math.max(pct, d.net.gt(0) ? 1.5 : 0)}%`, "--i": i } as React.CSSProperties} />
                <span className="mb-label">{d.label}</span>
              </div>
            );
          })}
        </div>
      </div>
      <details className="mb-table">
        <summary>Ver como tabla</summary>
        <table className="table mt-2">
          <caption className="sr-only">{caption}</caption>
          <thead><tr><th>Mes</th><th className="num">Venta neta</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.key}><td>{d.label} {d.year}</td><td className="num">{fmtMoney(d.net)}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

/** Tope del eje redondeado (1, 2, 2.5, 5 × 10ⁿ). */
function niceMax(v: number) {
  if (v <= 0) return 0;
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}

function compact(v: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", notation: "compact", maximumFractionDigits: 1 }).format(v);
}
