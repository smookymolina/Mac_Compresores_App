"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, pctToFraction, uuid } from "@/lib/validation";
import { convertQuoteToSale } from "@/modules/sales/service";
import { changeQuoteStatus, createQuote, updateQuote } from "./service";

const itemSchema = z.object({
  productId: uuid,
  quantity: decimalStr({ min: 0.001, scale: 3 }),
  discountPct: pctToFraction,
  unitPrice: decimalStr({ min: 0, scale: 2 }).optional().or(z.literal("").transform(() => undefined)),
});

const quoteSchema = z.object({
  customerId: uuid,
  validUntil: z.coerce.date(),
  notes: z.string().trim().max(2000).optional(),
  items: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Partidas inválidas" });
        return z.NEVER;
      }
    })
    .pipe(z.array(itemSchema).min(1, "Agrega al menos una partida").max(200)),
});

export async function saveQuoteAction(id: string | undefined, _: ActionResult<unknown> | null, fd: FormData) {
  let quoteId = id;
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.write");
    const data = quoteSchema.parse({
      customerId: fd.get("customerId"),
      validUntil: fd.get("validUntil"),
      notes: fd.get("notes") ?? undefined,
      items: fd.get("items"),
    });
    if (id) await updateQuote(user, id, data);
    else quoteId = (await createQuote(user, data)).id;
  });
  if (res.ok) {
    revalidatePath("/cotizaciones");
    redirect(`/cotizaciones/${quoteId}`);
  }
  return res;
}

const statusSchema = z.enum(["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"]);

export async function changeQuoteStatusAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.write");
    await changeQuoteStatus(user, id, statusSchema.parse(fd.get("to")));
  }, "Estado actualizado.");
  if (res.ok) revalidatePath(`/cotizaciones/${id}`);
  return res;
}

export async function convertToSaleAction(quoteId: string, _: ActionResult<unknown> | null, fd: FormData) {
  let saleId: string | undefined;
  const res = await runAction(async () => {
    const user = await requirePermission("sales.create");
    saleId = (await convertQuoteToSale(user, quoteId, uuid.parse(fd.get("warehouseId")))).id;
  });
  if (res.ok && saleId) {
    revalidatePath("/ventas");
    redirect(`/ventas/${saleId}`);
  }
  return res;
}
