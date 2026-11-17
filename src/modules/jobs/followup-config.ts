/**
 * Umbrales del seguimiento automático de cotizaciones (trabajo diario).
 * Interpretación de `adminAmountThreshold`: las cotizaciones con total >= $500 000 MXN escalan a
 * administradores desde el primer aviso (`*SellerDays`); las demás, a los `*AdminDays`.
 * El total se guarda siempre en MXN (ver quotes/currency.ts), así que se compara sin conversión.
 */
export const FOLLOWUP = {
  draftSellerDays: 2,
  draftAdminDays: 5,
  draftCancelDays: 10,
  acceptedSellerDays: 2,
  acceptedAdminDays: 5,
  adminAmountThreshold: "500000",
} as const;
