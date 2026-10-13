/** "15" -> "15 %"; 2 decimales solo si los hay. Entrada ya numérica (presentación). */
export function pctLabel(v: { toDecimalPlaces(n: number): { toString(): string } } | number | string): string {
  const n = typeof v === "object" ? v.toDecimalPlaces(2).toString() : String(Math.round(Number(v) * 100) / 100);
  return `${n} %`;
}
