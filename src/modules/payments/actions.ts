"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, optStr, uuid } from "@/lib/validation";
import { registerPayment, voidPayment } from "./service";
import { sendPaymentReminder } from "./reminder";

export async function registerPaymentAction(saleId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("payments.write");
    const d = z.object({
      amount: decimalStr({ min: 0.01, scale: 2 }),
      paidAt: z.coerce.date(),
      method: z.enum(["TRANSFER", "CASH", "CARD", "CHECK", "OTHER"]),
      reference: optStr,
    }).parse({ amount: fd.get("amount"), paidAt: fd.get("paidAt"), method: fd.get("method"), reference: fd.get("reference") ?? undefined });
    await registerPayment(user, uuid.parse(saleId), d);
  }, "Pago registrado.");
  if (res.ok) { revalidatePath(`/ventas/${saleId}`); revalidatePath("/ventas"); revalidatePath("/cobranza"); }
  return res;
}

export async function voidPaymentAction(paymentId: string, _: ActionResult<unknown> | null, fd: FormData) {
  let saleId: string | undefined;
  const res = await runAction(async () => {
    const user = await requirePermission("payments.write");
    saleId = await voidPayment(user, uuid.parse(paymentId), z.string().trim().min(5, "Indica el motivo").max(300).parse(fd.get("reason")));
  }, "Pago anulado.");
  if (res.ok && saleId) { revalidatePath(`/ventas/${saleId}`); revalidatePath("/ventas"); revalidatePath("/cobranza"); }
  return res;
}

const emailList = z.string().trim().max(500).transform((v) => v.split(/[,;\s]+/).filter(Boolean))
  .pipe(z.array(z.string().email("Correo inválido")).max(10, "Máximo 10 correos"));

/** Recordatorio de pago al cliente: solo envío manual (nunca desde el trabajo diario). */
export async function sendPaymentReminderAction(saleId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("payments.write");
    const d = z.object({
      to: emailList.refine((v) => v.length > 0, "Indica al menos un correo"),
      cc: emailList,
      message: z.string().trim().min(1, "Escribe un mensaje").max(3000, "Máximo 3000 caracteres"),
    }).parse({ to: fd.get("to") ?? "", cc: fd.get("cc") ?? "", message: fd.get("message") ?? "" });
    await sendPaymentReminder(user, uuid.parse(saleId), d);
  }, "Recordatorio enviado.");
  if (res.ok) { revalidatePath(`/ventas/${saleId}`); revalidatePath("/cobranza"); }
  return res;
}
