import { z } from "zod";
import { decimalStr, optStr } from "@/lib/validation";

/** Esquemas de captura de clientes compartidos por la web (actions.ts) y la app móvil (sync/protocol.ts). */
// RFC persona moral (12) o física (13).
const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "RFC inválido")
  .optional()
  .or(z.literal("").transform(() => undefined));

export const customerSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  rfc,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: optStr,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  creditLimit: decimalStr({ min: 0, scale: 2 }).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional(),
  ownerId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  position: optStr,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: optStr,
});

export const addressSchema = z.object({
  street: z.string().trim().min(3).max(300),
  city: optStr,
  state: optStr,
  zip: optStr,
});
