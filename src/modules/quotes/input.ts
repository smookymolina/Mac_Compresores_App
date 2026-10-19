import "server-only";
import { z } from "zod";
import { can, type CurrentUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { decimalStr, pctToFraction, uuid } from "@/lib/validation";
import { listPackages, savePackageFromQuote } from "@/modules/complements/service";
import type { QuoteComplement } from "@/modules/complements/match";

/** Esquemas de captura de cotización compartidos por la web (actions.ts) y la app móvil (sync/protocol.ts). */
export const quoteItemSchema = z.object({
  productId: uuid,
  quantity: decimalStr({ min: 0.001, scale: 3 }),
  discountPct: pctToFraction,
  unitPrice: decimalStr({ min: 0, scale: 2 }).optional().or(z.literal("").transform(() => undefined)),
  details: z.string().trim().max(4000).optional(),
});

export const quoteComplementSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().max(120),
  activities: z.array(z.string().trim().min(1).max(300)).max(60),
  saveAs: z.object({ shared: z.boolean() }).optional(),
});

/** Campos de la cotización sin partidas ni complementos (estos llegan como JSON en la web y como arreglo en el móvil). */
export const quoteFieldsSchema = z.object({
  customerId: uuid,
  validUntil: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  deliveryTime: z.string().trim().max(200).optional(),
  currency: z.enum(["MXN", "USD"]).default("USD"),
  /** Vendedor asignado; solo con `quotes.assign_seller` puede ser otro (v1.3.19). */
  sellerId: z.union([z.literal("").transform(() => undefined), uuid]).optional(),
  /** Motivo del descuento cuando requiere autorización de un administrador (v1.3.19). */
  discountNote: z.string().trim().max(500).optional(),
  warrantyMonths: z.union([z.literal("").transform(() => undefined), z.coerce.number().int().min(0).max(60)]).optional(),
});

/** Estados a los que se puede mover manualmente una cotización. */
export const quoteStatusSchema = z.enum(["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]);

type ComplementIn = z.infer<typeof quoteComplementSchema>;

/**
 * Regla de complementos: solo ADMIN (`complements.manage`) redacta; los demás eligen paquetes y
 * actividades del catálogo (o lo que ya tenía la cotización `quoteId`). Los personalizados con
 * «Guardar en paquetes» se registran en el catálogo.
 */
export async function resolveComplements(
  user: CurrentUser, complements: ComplementIn[], quoteId: string | undefined, warrantyMonths: number | undefined,
): Promise<QuoteComplement[]> {
  if (!can(user, "complements.manage")) {
    const catalog = new Map((await listPackages(false, true)).map((p) => [p.code, p.activities]));
    const prev = quoteId ? ((await db.quote.findUnique({ where: { id: quoteId }, select: { complements: true } }))?.complements as QuoteComplement[] | null) ?? [] : [];
    for (const c of prev) catalog.set(c.code, [...(catalog.get(c.code) ?? []), ...c.activities]);
    const ok = complements.every((c) => catalog.get(c.code)?.length !== undefined && c.activities.every((a) => catalog.get(c.code)!.includes(a)));
    if (!ok) throw new AppError("Solo el administrador puede agregar complementos o actividades nuevas.", "FORBIDDEN");
    return complements.map(({ saveAs: _, ...c }) => c);
  }
  return Promise.all(complements.map(async ({ saveAs, ...c }) =>
    saveAs && c.code.startsWith("PERSONALIZADO")
      ? { ...c, code: await savePackageFromQuote(user, c, saveAs.shared, warrantyMonths ?? 3) }
      : c));
}
