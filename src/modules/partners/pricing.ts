import "server-only";
import { db } from "@/lib/db";
import { D, dec, round2, type Dec, type DecInput } from "@/lib/money";

export const SETTING_DISCOUNT = "partners.discountPct";
export const SETTING_QUOTA = "partners.dailyQuota";
export const DEFAULT_DISCOUNT_PCT = 15;
export const DEFAULT_DAILY_QUOTA = 80;

export interface PartnerSettings {
  /** Descuento global en puntos porcentuales (0-60). */
  discountPct: Dec;
  /** Consultas diarias por socio. */
  dailyQuota: number;
}

/** Ajustes globales del portal (tabla Setting) con valores por defecto si faltan o son inválidos. */
export async function getPartnerSettings(): Promise<PartnerSettings> {
  const rows = await db.setting.findMany({ where: { key: { in: [SETTING_DISCOUNT, SETTING_QUOTA] } } });
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const pct = Number(get(SETTING_DISCOUNT));
  const quota = Number(get(SETTING_QUOTA));
  return {
    discountPct: new D(Number.isFinite(pct) && pct >= 0 && pct <= 60 ? pct : DEFAULT_DISCOUNT_PCT),
    dailyQuota: Number.isInteger(quota) && quota >= 1 ? quota : DEFAULT_DAILY_QUOTA,
  };
}

/** Descuento vigente del socio: el propio si existe (incluso 0) o, si no, el global. Puro. */
export function effectiveDiscount(partner: { discountPct: DecInput | null }, settings: Pick<PartnerSettings, "discountPct">): Dec {
  return partner.discountPct === null || partner.discountPct === undefined ? dec(settings.discountPct) : dec(partner.discountPct);
}

/** Precio al socio = round2(precio × (1 − pct/100)), half-up, en la moneda del producto. Puro. */
export function getPartnerPrice(price: DecInput, pct: DecInput): Dec {
  return round2(dec(price).mul(new D(1).sub(dec(pct).div(100))));
}
