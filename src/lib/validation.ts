import { z } from "zod";

/** Decimal como string validado (evita float en el transporte). */
export const decimalStr = (opts: { min?: number; max?: number; scale?: number } = {}) =>
  z
    .string()
    .trim()
    .transform((s) => s.replace(/[$,\s]/g, ""))
    .refine((s) => new RegExp(`^-?\\d+(\\.\\d{1,${opts.scale ?? 4}})?$`).test(s), "Número inválido")
    .refine((s) => opts.min === undefined || Number(s) >= opts.min, `Mínimo ${opts.min}`)
    .refine((s) => opts.max === undefined || Number(s) <= opts.max, `Máximo ${opts.max}`);

/** Porcentaje capturado como 0-100 → fracción string. */
export const pctToFraction = z
  .string()
  .trim()
  .default("0")
  .transform((s) => (s === "" ? "0" : s))
  .refine((s) => /^\d+(\.\d{1,2})?$/.test(s) && Number(s) <= 100, "Porcentaje inválido")
  .transform((s) => (Number(s) / 100).toFixed(4));

export const optStr = z.string().trim().max(300).optional().transform((v) => (v ? v : undefined));
export const uuid = z.string().uuid();

export function formObject(fd: FormData) {
  return Object.fromEntries([...fd.entries()].filter(([, v]) => typeof v === "string"));
}
