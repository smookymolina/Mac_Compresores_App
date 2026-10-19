/** Paquete de complementos tal como se copia a la cotización (el catálogo puede cambiar después). */
export interface QuoteComplement {
  code: string;
  name: string;
  activities: string[];
  /** Solo admin, en un Personalizado: guardarlo en el catálogo (shared = visible para los demás). */
  saveAs?: { shared: boolean };
}

export interface ComplementOption extends QuoteComplement {
  warrantyMonths: number;
  skuPatterns: string[];
}

/** Comodín "*" sobre el texto completo (SKU o descripción), sin distinguir mayúsculas. */
export function skuMatches(pattern: string, sku: string) {
  const re = pattern.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return !!re && new RegExp(`^${re}$`, "i").test(sku.trim());
}

export const suggestFor = (options: ComplementOption[], sku: string, description = "") =>
  options.filter((o) => o.skuPatterns.some((p) => skuMatches(p, sku) || (!!description && skuMatches(p, description))));

export const warrantyText = (n: number) => `${n} ${n === 1 ? "mes" : "meses"}`;
