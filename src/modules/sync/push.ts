import "server-only";
import { Prisma, type Device } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assertCan, type CurrentUser } from "@/lib/auth/session";
import { saveCustomer } from "@/modules/customers/service";
import { changeQuoteStatus, createQuote, updateQuote } from "@/modules/quotes/service";
import { resolveComplements } from "@/modules/quotes/input";
import { convertQuoteToSale } from "@/modules/sales/service";
import { registerPayment } from "@/modules/payments/service";
import {
  MAX_PUSH_COMMANDS, commandEnvelope, syncCommandSchema,
  type PushResult, type SyncCommand,
} from "./protocol";

type Outcome = { status: "APPLIED" | "REJECTED" | "CONFLICT"; result?: Prisma.InputJsonObject; error?: string };

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

/** Aplica un comando con el servicio existente (mismo permiso que la acción web). */
async function apply(user: CurrentUser, device: Device, c: SyncCommand): Promise<Prisma.InputJsonObject> {
  const meta = { deviceId: device.id, capturedAt: c.capturedAt };
  switch (c.type) {
    case "customer.save": {
      assertCan(user, "customers.write");
      const { id, contact, address, ...input } = c.payload;
      const exists = await db.customer.findUnique({ where: { id }, select: { id: true } });
      const saved = exists
        ? await saveCustomer(user, input, id, meta)
        : await saveCustomer(user, { ...input, contact, address }, undefined, { ...meta, createId: id });
      return { id: saved.id, updatedAt: saved.updatedAt.toISOString() };
    }
    case "quote.create": {
      assertCan(user, "quotes.write");
      const { id, folio, catalogSeq, ...data } = c.payload;
      const complements = await resolveComplements(user, data.complements, undefined, data.warrantyMonths);
      const q = await createQuote(user, { ...data, complements }, {
        id, folio, catalogSeq, origin: "MOBILE", deviceId: device.id, offlineCreatedAt: c.capturedAt,
      });
      return { id: q.id, folio: q.folio, total: q.total.toString(), updatedAt: q.updatedAt.toISOString() };
    }
    case "quote.update": {
      assertCan(user, "quotes.write");
      const { quoteId, baseUpdatedAt, ...data } = c.payload;
      const complements = await resolveComplements(user, data.complements, quoteId, data.warrantyMonths);
      const q = await updateQuote(user, quoteId, { ...data, complements }, { ...meta, baseUpdatedAt });
      return { id: q.id, folio: q.folio, updatedAt: q.updatedAt.toISOString() };
    }
    case "quote.status": {
      assertCan(user, "quotes.write");
      await changeQuoteStatus(user, c.payload.quoteId, c.payload.to, meta);
      return { id: c.payload.quoteId, status: c.payload.to };
    }
    case "sale.convert": {
      assertCan(user, "sales.create");
      const s = await convertQuoteToSale(user, c.payload.quoteId, c.payload.warehouseId, meta);
      return { id: s.id, folio: s.folio, quoteId: c.payload.quoteId };
    }
    case "payment.register": {
      assertCan(user, "payments.write");
      const { saleId, ...input } = c.payload;
      const p = await registerPayment(user, saleId, input, meta);
      return { id: p.id, saleId: p.saleId, amount: p.amount.toString() };
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
        try {
          o = { status: "APPLIED", result: await apply(user, device, parsed.data) };
        } catch (e) {
          // Una transición de estado imposible no es un conflicto que gerencia resuelva: se rechaza (§5.2).
          const conflict = e instanceof AppError && e.code === "CONFLICT" && parsed.data.type !== "quote.status";
          if (e instanceof AppError) o = { status: conflict ? "CONFLICT" : "REJECTED", error: e.message };
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
