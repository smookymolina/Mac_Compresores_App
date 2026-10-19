import { z } from "zod";
import { decimalStr, uuid } from "@/lib/validation";
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
  items: z.array(quoteItemSchema.extend({
    /** Precio de lista unitario MXN (antes de descuento) que mostró el teléfono; ausente si la partida trae `unitPrice` manual. */
    clientListPrice: decimalStr({ min: 0, scale: 2 }).optional(),
  })).min(1, "Agrega al menos una partida").max(200),
  /** TC USD→MXN que usó el teléfono. */
  clientExchangeRate: decimalStr({ min: 0.0001, scale: 4 }).optional(),
});

export type SyncQuotePayload = z.infer<typeof quotePayload>;

/** Resultado guardado en SyncCommand.result cuando un precio capturado sin red no se pudo respetar (§5.3). */
export interface PriceConflictResult {
  kind: "price";
  items: { productId: string; sku: string; clientPrice: string; serverPrice: string }[];
  exchangeRate?: { client: string | null; server: string | null };
}

/** Conflicto de existencias (venta o salida de inventario): lo que se pidió contra lo disponible en el almacén. */
export interface StockConflictResult {
  kind: "stock";
  warehouseId: string;
  items: { productId: string; sku: string; requested: string; available: string }[];
}

/** RFC ya registrado en otro cliente (`Customer.rfc` es único). */
export interface DuplicateRfcResult {
  kind: "duplicate_rfc";
  rfc: string;
}

export type ConflictResult = PriceConflictResult | StockConflictResult | DuplicateRfcResult;

/** Campos escalares de cliente que el teléfono puede mandar en `changedFields` (fusión por campo, §5.2). */
export const customerFields = z.enum(["legalName", "rfc", "email", "phone", "paymentTermsDays", "creditLimit", "notes", "ownerId"]);

const cmd = <T extends string, P extends z.ZodTypeAny>(type: T, payload: P) =>
  commandEnvelope.extend({ type: z.literal(type), payload });

export const syncCommandSchema = z.discriminatedUnion("type", [
  /** Crea (si `id` no existe en el servidor) o actualiza un cliente. */
  cmd("customer.save", customerSchema.extend({
    id: uuid,
    contact: contactSchema.optional(),
    address: addressSchema.optional(),
    /** `updatedAt` del cliente que editó el teléfono (solo informativo: se audita si el servidor cambió después). */
    baseUpdatedAt: z.coerce.date().optional(),
    /** En un cliente existente, solo se aplican estos campos (gana la última edición por campo). */
    changedFields: z.array(customerFields).max(customerFields.options.length).optional(),
  })),
  cmd("customer.contact.add", contactSchema.extend({ customerId: uuid, id: uuid })),
  cmd("customer.contact.remove", z.object({ customerId: uuid, contactId: uuid })),
  cmd("customer.address.add", addressSchema.extend({
    customerId: uuid, id: uuid, label: z.string().trim().min(1).max(60).default("Principal"),
  })),
  cmd("customer.address.remove", z.object({ customerId: uuid, addressId: uuid })),
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
  /** Entrada, salida o ajuste de inventario. `quantity` positiva en IN/OUT; con signo en ADJUST. */
  cmd("inventory.movement", z.object({
    id: uuid,
    productId: uuid,
    warehouseId: uuid,
    type: z.enum(["IN", "OUT", "ADJUST"]),
    quantity: decimalStr({ scale: 3 }),
    reason: z.string().trim().min(3).max(300),
  })),
  /** Envía la cotización por correo con el PDF (mismo servicio y permiso que la web). */
  cmd("quote.email", z.object({
    quoteId: uuid,
    to: z.array(z.string().trim().email("Correo inválido")).min(1, "Indica al menos un correo").max(5),
    cc: z.array(z.string().trim().email("Correo inválido")).max(10).default([]),
    message: z.string().trim().max(4000),
  })),
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
