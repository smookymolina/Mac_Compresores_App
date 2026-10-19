import { z } from "zod";
import { decimalStr, optStr } from "@/lib/validation";

/** Captura de un pago, compartida por la web (actions.ts) y la app móvil (sync/protocol.ts). */
export const paymentSchema = z.object({
  amount: decimalStr({ min: 0.01, scale: 2 }),
  paidAt: z.coerce.date(),
  method: z.enum(["TRANSFER", "CASH", "CARD", "CHECK", "OTHER"]),
  reference: optStr,
});
