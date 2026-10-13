/** Resultado de la detección de barrido (extracción masiva del catálogo). */
export interface SweepResult {
  suspect: boolean;
  reason?: "incremental" | "alphabetical";
  /** Longitud de la racha más larga detectada (en términos). */
  run: number;
}

export const SWEEP_INCREMENTAL_RUN = 4;
export const SWEEP_ALPHABETICAL_RUN = 6;

const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** `b` sigue a `a` en un barrido: misma longitud y un solo carácter distinto, con +1 o +2 posiciones en el alfabeto. */
function isIncrement(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let diff = -1;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      if (diff !== -1) return false;
      diff = i;
    }
  }
  if (diff === -1) return false;
  const d = b.charCodeAt(diff) - a.charCodeAt(diff);
  return d >= 1 && d <= 2;
}

/**
 * Detecta barridos en las últimas búsquedas (de la más antigua a la más reciente). Función pura.
 *  - incremental: rachas de ≥4 términos donde cada uno avanza una letra/dígito sobre el anterior (aaa, aab, aac, aad).
 *  - alphabetical: rachas de ≥6 términos distintos, de igual longitud (≤4), en orden alfabético estricto.
 * Escribir progresivamente («com», «comp», «compr») NO cuenta: es uso normal del buscador.
 */
export function detectSweep(terms: string[]): SweepResult {
  const t = terms.map(norm).filter(Boolean);
  let inc = 1, maxInc = 1, alpha = 1, maxAlpha = 1;
  for (let i = 1; i < t.length; i++) {
    const a = t[i - 1]!, b = t[i]!;
    inc = isIncrement(a, b) ? inc + 1 : 1;
    maxInc = Math.max(maxInc, inc);
    alpha = a.length === b.length && b.length <= 4 && b > a ? alpha + 1 : 1;
    maxAlpha = Math.max(maxAlpha, alpha);
  }
  if (maxInc >= SWEEP_INCREMENTAL_RUN) return { suspect: true, reason: "incremental", run: maxInc };
  if (maxAlpha >= SWEEP_ALPHABETICAL_RUN) return { suspect: true, reason: "alphabetical", run: maxAlpha };
  return { suspect: false, run: Math.max(maxInc, maxAlpha) };
}
