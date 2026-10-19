"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { emailQuote, logQuoteWhatsApp, shareQuoteLink } from "./email";
import { normalizePhone } from "./phone";
import { requirePermission } from "@/lib/auth/session";
import { quoteComplementSchema, quoteFieldsSchema, quoteItemSchema, quoteStatusSchema, resolveComplements } from "./input";
import { runAction, type ActionResult } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { convertQuoteToSale } from "@/modules/sales/service";
import { changeQuoteStatus, createQuote, deleteQuote, updateQuote } from "./service";

const quoteSchema = quoteFieldsSchema.extend({
  complements: z
    .string()
    .transform((s, ctx) => {
      try {
        return JSON.parse(s || "[]") as unknown;
      } catch {
        ctx.addIssue({ code: "custom", message: "Complementos inválidos" });
        return z.NEVER;
      }
    })
    .pipe(z.array(quoteComplementSchema).max(10)),
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
    .pipe(z.array(quoteItemSchema).min(1, "Agrega al menos una partida").max(200)),
});

export async function saveQuoteAction(id: string | undefined, _: ActionResult<unknown> | null, fd: FormData) {
  let quoteId = id;
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.write");
    const data = quoteSchema.parse({
      customerId: fd.get("customerId"),
      validUntil: fd.get("validUntil"),
      notes: fd.get("notes") ?? undefined,
      deliveryTime: fd.get("deliveryTime") ?? undefined,
      currency: fd.get("currency") ?? undefined,
      warrantyMonths: fd.get("warrantyMonths") ?? undefined,
      complements: fd.get("complements") ?? "[]",
      items: fd.get("items"),
    });
    const complements = await resolveComplements(user, data.complements, id, data.warrantyMonths);
    const input = { ...data, complements };
    if (id) await updateQuote(user, id, input);
    else quoteId = (await createQuote(user, input)).id;
  });
  if (res.ok) {
    revalidatePath("/cotizaciones");
    redirect(`/cotizaciones/${quoteId}`);
  }
  return res;
}

export async function changeQuoteStatusAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.write");
    await changeQuoteStatus(user, id, quoteStatusSchema.parse(fd.get("to")));
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

const emailList = z.string().trim().max(500).transform((v) => v.split(/[,;\s]+/).filter(Boolean))
  .pipe(z.array(z.string().email("Correo inválido")).max(10));

export async function emailQuoteAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.write");
    const d = z.object({
      to: emailList.refine((v) => v.length > 0, "Indica al menos un correo"),
      cc: emailList,
      message: z.string().trim().min(1, "Escribe un mensaje").max(2000),
    }).parse({ to: fd.get("to"), cc: fd.get("cc") ?? "", message: fd.get("message") });
    await emailQuote(user, id, d);
  }, "Cotización enviada por correo.");
  if (res.ok) revalidatePath(`/cotizaciones/${id}`);
  return res;
}

/** Enlace público firmado al PDF para WhatsApp. */
export async function shareQuoteLinkAction(id: string, _fd: FormData) {
  return runAction(async () => {
    const user = await requirePermission("quotes.write");
    return shareQuoteLink(user, uuid.parse(id));
  });
}

const whatsappLog = z.object({
  phone: z.string().trim().max(30).optional().transform((v) => normalizePhone(v)),
  channel: z.enum(["link", "file"]),
});

/** Auditoría del envío por WhatsApp (y borrador → «Enviada»). */
export async function logQuoteWhatsAppAction(id: string, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.write");
    const d = whatsappLog.parse({ phone: fd.get("phone") ?? undefined, channel: fd.get("channel") });
    await logQuoteWhatsApp(user, uuid.parse(id), d);
  });
  if (res.ok) revalidatePath(`/cotizaciones/${id}`);
  return res;
}

export async function deleteQuoteAction(id: string, _: ActionResult<unknown> | null, _fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("quotes.delete");
    await deleteQuote(user, uuid.parse(id));
  }, "Cotización eliminada.");
  if (res.ok) {
    revalidatePath("/cotizaciones");
    redirect("/cotizaciones");
  }
  return res;
}
