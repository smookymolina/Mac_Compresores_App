/**
 * CSV compatible con Excel (BOM UTF-8, CRLF, separador coma). Protege contra inyección de fórmulas:
 * un texto que empieza con = + - @ (y no es un número) se antepone con apóstrofo.
 */
export type CsvCell = string | number | null | undefined | { toString(): string };

const NUMERIC = /^-?\d+(\.\d+)?$/;

export function csvCell(v: CsvCell): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "string" ? v : v.toString();
  if (/^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: CsvCell[][]): string {
  return "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
