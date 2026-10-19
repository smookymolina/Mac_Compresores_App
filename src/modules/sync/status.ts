import "server-only";
import { z } from "zod";
import type { Device } from "@prisma/client";
import { db } from "@/lib/db";
import { can, type CurrentUser } from "@/lib/auth/session";
import { uuid } from "@/lib/validation";
import { MAX_DISCOUNT_WITHOUT_OVERRIDE } from "@/domain/rules";
import { bankInfo } from "@/modules/quotes/pdf";
import { syncSettings } from "./settings";

/** Configuración que el teléfono necesita para cotizar y armar el PDF sin conexión. */
export async function deviceConfig(user: CurrentUser) {
  const [u, s] = await Promise.all([
    db.user.findUnique({ where: { id: user.id }, select: { quoteBlock: true } }),
    syncSettings(),
  ]);
  const bank = bankInfo();
  return {
    bankInfo: bank.length ? bank.join("\n") : null,
    sellerBlockPng: u?.quoteBlock ? Buffer.from(u.quoteBlock).toString("base64") : null,
    maxDiscountPct: String(MAX_DISCOUNT_WITHOUT_OVERRIDE),
    canOverridePrice: can(user, "quotes.override_price"),
    priceGraceDays: s.priceGraceDays,
    maxOfflineDays: s.maxOfflineDays,
  };
}

const idsSchema = z.string().default("")
  .transform((v) => [...new Set(v.split(",").map((x) => x.trim()).filter(Boolean))])
  .pipe(z.array(uuid).max(100, "Máximo 100 comandos por consulta"));

/** Estado actual de comandos ya enviados (p. ej. un conflicto que gerencia resolvió). Solo los de este dispositivo. */
export async function commandStatuses(device: Device, idsParam: string | null) {
  const ids = idsSchema.parse(idsParam ?? "");
  if (!ids.length) return [];
  const rows = await db.syncCommand.findMany({
    where: { id: { in: ids }, deviceId: device.id },
    select: { id: true, status: true, result: true, error: true, resolvedAt: true },
  });
  return rows;
}
