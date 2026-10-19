import { z } from "zod";
import { uuid } from "@/lib/validation";
import { quoteComplementSchema, quoteFieldsSchema, quoteItemSchema, quoteStatusSchema } from "@/modules/quotes/input";
import { addressSchema, contactSchema, customerSchema } from "@/modules/customers/input";
import { paymentSchema } from "@/modules/payments/input";

/**
 * Comandos que la app móvil manda en `POST /api/sync/push`. Cada comando lleva un UUID generado en el
 * teléfono (idempotencia) y la hora real de captura. Decimales como string; porcentajes 0–100 (igual que la web).
 */
export const MAX_PUSH_COMMANDS = 100;

/** Sobre mínimo: lo que se necesita para guardar el resultado aunque el payload sea inválido. */
export const commandEnvelope = z.object({
  id: uuid,
  type: z.string().min(1).max(40),
  capturedAt: z.coerce.date(),
});

const quotePayload = quoteFieldsSchema.extend({
  complements: z.array(quoteComplementSchema.omit({ saveAs: true })).max(10).default([]),
  items: z.array(quoteItemSchema).min(1, "Agrega al menos una partida").max(200),
});

const cmd = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  commandEnvelope.extend({ type: z.literal(type), payload });

export const syncCommandSchema = z.discriminatedUnion("type", [
  /** Crea (si `id` no existe en el servidor) o actualiza un cliente. */
  cmd("customer.save", customerSchema.extend({
    id: uuid,
    contact: contactSchema.optional(),
    address: addressSchema.optional(),
  })),
  cmd("quote.create", quotePayload.extend({
    id: uuid,
    /** Folio apartado por este dispositivo (`/api/sync/folios`); sin él, el servidor asigna uno. */
    folio: z.number().int().positive().optional(),
    /** Versión del catálogo (SyncChange.seq) con la que cotizó el teléfono. */
    catalogSeq: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative()]).transform((v) => BigInt(v)).optional(),
  })),
  cmd("quote.update", quotePayload.extend({
    quoteId: uuid,
    /** `updatedAt` de la versión que editó el teléfono (bloqueo optimista). */
    baseUpdatedAt: z.coerce.date(),
  })),
  cmd("quote.status", z.object({ quoteId: uuid, to: quoteStatusSchema })),
  cmd("sale.convert", z.object({ quoteId: uuid, warehouseId: uuid })),
  cmd("payment.register", paymentSchema.extend({ id: uuid, saleId: uuid })),
]);

export type SyncCommand = z.infer<typeof syncCommandSchema>;
export type SyncCommandType = SyncCommand["type"];

export type PushStatus = "APPLIED" | "REJECTED" | "CONFLICT" | "retry";

export interface PushResult {
  id: string;
  status: PushStatus;
  result?: unknown;
  error?: string;
}

export const pushRequestSchema = z.object({
  commands: z.array(z.unknown()).max(MAX_PUSH_COMMANDS, `Máximo ${MAX_PUSH_COMMANDS} comandos por envío`),
});
