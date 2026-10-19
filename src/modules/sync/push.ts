import "server-only";
import { Prisma, type Device } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { addAddress, addContact, removeAddress, removeContact, saveCustomer } from "@/modules/customers/service";
import { registerMovement } from "@/modules/inventory/service";
import { quoteScope } from "@/modules/quotes/service";
import { changeQuoteStatus, createQuote, updateQuote } from "@/modules/quotes/service";
import { resolveComplements } from "@/modules/quotes/input";
import { convertQuoteToSale } from "@/modules/sales/service";
import { registerPayment } from "@/modules/payments/service";
import { emailQuote } from "@/modules/quotes/email";
import { audit } from "@/lib/audit";
import { dec } from "@/lib/money";
import { PriceConflictError, evaluatePriceGrace } from "./price-grace";
import { SyncConflictError, stockConflict, stockShortages } from "./conflicts";
import {
  MAX_PUSH_COMMANDS, commandEnvelope, syncCommandSchema,
  type PushResult, type SyncCommand, type SyncQuotePayload,
} from "./protocol";

/**
 * Cómo tratar los precios que mostró el teléfono: `grace` = regla de §5.3 (respeta o CONFLICT);
 * `server` = ignorarlos (precios vigentes); `client` = respetarlos todos (gerencia lo autorizó).
 */
export type PriceMode = "grace" | "server" | "client";

/** Quita los campos del teléfono y calcula la excepción de precio (o lanza PriceConflictError). */
async function quotePricing(user: CurrentUser, device: Device, c: { capturedAt: Date }, data: SyncQuotePayload, mode: PriceMode) {
  const { clientExchangeRate: _fx, items, ...rest } = data;
  const input = { ...rest, items: items.map(({ clientListPrice: _p, ...it }) => it) };
  if (mode === "server") return { input };
  const d = await evaluatePriceGrace(data, c.capturedAt, { force: mode === "client" });
  if (!d) return { input };
  if (d.kind === "conflict") throw new PriceConflictError(d.result);
  const logGrace = async (quoteId: string) => {
    if (!d.accepted.length && !d.exchangeRate) return;
    await audit({ userId: user.id, action: "quote.price_grace", entity: "Quote", entityId: quoteId, data: {
      mode, deviceId: device.id, capturedAt: c.capturedAt.toISOString(), items: d.accepted, ...(d.exchangeRate && { exchangeRate: d.exchangeRate }),
    } });
  };
  return { input, priceGrace: d.grace, logGrace };
}

type Outcome = { status: "APPLIED" | "REJECTED" | "CONFLICT"; result?: Prisma.InputJsonObject; error?: string };

/** Tolerancia del reloj del teléfono hacia el futuro. */
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

const isRfcViolation = (e: unknown) => isUniqueViolation(e)
  && JSON.stringify((e as Prisma.PrismaClientKnownRequestError).meta?.target ?? "").includes("rfc");

/** Venta ya creada desde la cotización (visible para el usuario): reintento idempotente por `quoteId`. */
async function existingSale(user: CurrentUser, quoteId: string) {
  const q = await db.quote.findFirst({ where: { AND: [{ id: quoteId }, quoteScope(user)] }, select: { sale: { select: { id: true, folio: true } } } });
  return q?.sale ?? null;
}

/** Error de `applyMovement` por salida mayor a la existencia (UPDATE condicionado). */
const isStockError = (e: unknown) => e instanceof AppError && e.code === "CONFLICT" && e.message.startsWith("Existencia insuficiente");

const saleResult = (s: { id: string; folio: number }, quoteId: string) => ({ id: s.id, saleId: s.id, folio: s.folio, quoteId });

/** Aplica un comando con el servicio existente (mismo permiso que la acción web). */
export async function applyCommand(user: CurrentUser, device: Device, c: SyncCommand, priceMode: PriceMode = "grace"): Promise<Prisma.InputJsonObject> {
  const meta = { deviceId: device.id, capturedAt: c.capturedAt };
  switch (c.type) {
    case "customer.save": {
      assertCan(user, "customers.write");
      const { id, contact, address, changedFields, baseUpdatedAt, ...input } = c.payload;
      const exists = await db.customer.findUnique({ where: { id }, select: { id: true } });
      try {
        const saved = exists
          ? await saveCustomer(user, input, id, { ...meta, changedFields, baseUpdatedAt })
          : await saveCustomer(user, { ...input, contact, address }, undefined, { ...meta, createId: id });
        return { id: saved.id, updatedAt: saved.updatedAt.toISOString() };
      } catch (e) {
        if (!isRfcViolation(e) || !input.rfc) throw e;
        throw new SyncConflictError(`Ya existe otro cliente con el RFC ${input.rfc.toUpperCase()}.`, { kind: "duplicate_rfc", rfc: input.rfc.toUpperCase() });
      }
    }
    case "customer.contact.add": {
      assertCan(user, "customers.write");
      const { customerId, id, ...contact } = c.payload;
      const ct = await addContact(user, customerId, contact, { ...meta, id });
      return { id: ct.id, customerId };
    }
    case "customer.contact.remove": {
      assertCan(user, "customers.write");
      await removeContact(user, c.payload.customerId, c.payload.contactId, { ...meta, idempotent: true });
      return { id: c.payload.contactId, customerId: c.payload.customerId, removed: true };
    }
    case "customer.address.add": {
      assertCan(user, "customers.write");
      const { customerId, id, ...address } = c.payload;
      const a = await addAddress(user, customerId, address, { ...meta, id });
      return { id: a.id, customerId };
    }
    case "customer.address.remove": {
      assertCan(user, "customers.write");
      await removeAddress(user, c.payload.customerId, c.payload.addressId, { ...meta, idempotent: true });
      return { id: c.payload.addressId, customerId: c.payload.customerId, removed: true };
    }
    case "inventory.movement": {
      assertCan(user, "inventory.write");
      const { id, ...input } = c.payload;
      if (!(await db.warehouse.findFirst({ where: { id: input.warehouseId, active: true }, select: { id: true } })))
        throw new AppError("Almacén inválido.");
      try {
        const mv = await registerMovement(user, input, { ...meta, id });
        return { id: mv.id, productId: mv.productId, warehouseId: mv.warehouseId, quantity: mv.quantity.toString() };
      } catch (e) {
        if (!isStockError(e)) throw e;
        const q = dec(input.quantity);
        const out = input.type === "OUT" ? q.abs() : q.neg();
        const items = out.gt(0) ? await stockShortages(input.warehouseId, [{ productId: input.productId, quantity: out }]) : [];
        if (items.length) throw stockConflict(input.warehouseId, items);
        throw e;
      }
    }
    case "quote.create": {
      assertCan(user, "quotes.write");
      const { id, folio, catalogSeq, ...data } = c.payload;
      const complements = await resolveComplements(user, data.complements, undefined, data.warrantyMonths);
      const { input, priceGrace, logGrace } = await quotePricing(user, device, c, data, priceMode);
      const q = await createQuote(user, { ...input, complements }, {
        id, folio, catalogSeq, origin: "MOBILE", deviceId: device.id, offlineCreatedAt: c.capturedAt, priceGrace,
      });
      await logGrace?.(q.id);
      return { id: q.id, folio: q.folio, total: q.total.toString(), updatedAt: q.updatedAt.toISOString() };
    }
    case "quote.update": {
      assertCan(user, "quotes.write");
      const { quoteId, baseUpdatedAt, ...data } = c.payload;
      const complements = await resolveComplements(user, data.complements, quoteId, data.warrantyMonths);
      const { input, priceGrace, logGrace } = await quotePricing(user, device, c, data, priceMode);
      const q = await updateQuote(user, quoteId, { ...input, complements }, { ...meta, baseUpdatedAt, priceGrace });
      await logGrace?.(q.id);
      return { id: q.id, folio: q.folio, updatedAt: q.updatedAt.toISOString() };
    }
    case "quote.status": {
      assertCan(user, "quotes.write");
      await changeQuoteStatus(user, c.payload.quoteId, c.payload.to, meta);
      return { id: c.payload.quoteId, status: c.payload.to };
    }
    case "sale.convert": {
      assertCan(user, "sales.create");
      const { quoteId, warehouseId } = c.payload;
      const prev = await existingSale(user, quoteId);
      if (prev) return saleResult(prev, quoteId);
      try {
        return saleResult(await convertQuoteToSale(user, quoteId, warehouseId, meta), quoteId);
      } catch (e) {
        if (!(e instanceof AppError) || e.code !== "CONFLICT") throw e;
        const again = await existingSale(user, quoteId);
        if (again) return saleResult(again, quoteId);
        if (!isStockError(e)) throw e;
        const items = await db.quoteItem.findMany({ where: { quoteId, kind: "PRODUCT", productId: { not: null } }, select: { productId: true, quantity: true } });
        const short = await stockShortages(warehouseId, items.map((i) => ({ productId: i.productId!, quantity: dec(i.quantity) })));
        if (short.length) throw stockConflict(warehouseId, short);
        throw e;
      }
    }
    case "payment.register": {
      assertCan(user, "payments.write");
      const { saleId, ...input } = c.payload;
      try {
        const p = await registerPayment(user, saleId, input, meta);
        return { id: p.id, saleId: p.saleId, amount: p.amount.toString() };
      } catch (e) {
        // Un pago no lo resuelve gerencia: se rechaza para que el vendedor lo corrija (p. ej. importe mayor al saldo).
        if (e instanceof AppError && e.code === "CONFLICT")
          throw new AppError(`Pago no registrado: ${e.message}${/saldo/.test(e.message) ? " Corrige el importe y vuelve a capturarlo." : ""}`);
        throw e;
      }
    }
    case "quote.email": {
      assertCan(user, "quotes.write");
      const { quoteId, ...input } = c.payload;
      await emailQuote(user, quoteId, input);
      return { id: quoteId, sentTo: input.to };
    }
  }
}

const toResult = (id: string, o: { status: string; result?: unknown; error?: string | null }): PushResult => ({
  id, status: o.status as PushResult["status"],
  ...(o.result != null && { result: o.result }), ...(o.error && { error: o.error }),
});

/** Guarda el resultado; si otro envío simultáneo ya lo guardó, gana el guardado. */
async function store(user: CurrentUser, device: Device, env: { id: string; type: string; capturedAt: Date }, raw: unknown, o: Outcome) {
  try {
    await db.syncCommand.create({
      data: {
        id: env.id, deviceId: device.id, userId: user.id, type: env.type, capturedAt: env.capturedAt,
        payload: (raw ?? {}) as Prisma.InputJsonValue, status: o.status, result: o.result, error: o.error,
      },
    });
    return toResult(env.id, o);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return toResult(env.id, await db.syncCommand.findUniqueOrThrow({ where: { id: env.id } }));
  }
}

/**
 * Aplica en orden los comandos del teléfono. Idempotente por `id` de comando: uno ya procesado
 * devuelve el resultado guardado. AppError CONFLICT → CONFLICT; otro AppError o datos inválidos →
 * REJECTED (ambos se guardan). Un error inesperado no se guarda: ese comando y los siguientes
 * regresan como `retry` (el teléfono los reenvía en el mismo orden).
 */
export async function push(user: CurrentUser, device: Device, commands: unknown[]): Promise<PushResult[]> {
  if (commands.length > MAX_PUSH_COMMANDS) throw new AppError(`Máximo ${MAX_PUSH_COMMANDS} comandos por envío.`);
  const out: PushResult[] = [];
  for (const raw of commands) {
    const env = commandEnvelope.safeParse(raw);
    if (!env.success) {
      const id = typeof raw === "object" && raw && "id" in raw ? String((raw as { id: unknown }).id) : "";
      out.push({ id, status: "REJECTED", error: "Comando inválido (id, type o capturedAt)." });
      continue;
    }
    const { id } = env.data;
    // Reloj del teléfono adelantado: no se acepta una hora de captura futura (se audita la original).
    const now = new Date();
    const skewed = env.data.capturedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS;
    const capturedAtClient = env.data.capturedAt;
    if (skewed) env.data.capturedAt = now;
    try {
      const prev = await db.syncCommand.findUnique({ where: { id } });
      if (prev) {
        out.push(prev.deviceId === device.id ? toResult(id, prev) : { id, status: "REJECTED", error: "Identificador de comando en uso." });
        continue;
      }
      const parsed = syncCommandSchema.safeParse(raw);
      let o: Outcome;
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        o = { status: "REJECTED", error: `Datos inválidos${issue ? ` (${issue.path.join(".")}: ${issue.message})` : ""}.` };
      } else {
        if (skewed) {
          parsed.data.capturedAt = now;
          await audit({ userId: user.id, action: "sync.captured_at_clamped", entity: "SyncCommand", entityId: id,
            data: { deviceId: device.id, type: parsed.data.type, capturedAtClient: capturedAtClient.toISOString(), capturedAt: now.toISOString() } });
        }
        try {
          o = { status: "APPLIED", result: await applyCommand(user, device, parsed.data) };
        } catch (e) {
          // Una transición de estado imposible no es un conflicto que gerencia resuelva: se rechaza (§5.2).
          const conflict = e instanceof AppError && e.code === "CONFLICT" && parsed.data.type !== "quote.status";
          if (e instanceof SyncConflictError) o = { status: "CONFLICT", error: e.message, result: e.result as unknown as Prisma.InputJsonObject };
          else if (e instanceof AppError) o = { status: conflict ? "CONFLICT" : "REJECTED", error: e.message };
          else if (isUniqueViolation(e)) o = { status: "CONFLICT", error: "Ya existe un registro con esos datos únicos." };
          else throw e;
        }
      }
      out.push(await store(user, device, env.data, raw, o));
    } catch (e) {
      console.error("[sync.push]", e instanceof Error ? e.message : "error desconocido");
      for (const r of commands.slice(out.length)) {
        const rid = typeof r === "object" && r && "id" in r ? String((r as { id: unknown }).id) : "";
        out.push({ id: rid, status: "retry" });
      }
      break;
    }
  }
  return out;
}
