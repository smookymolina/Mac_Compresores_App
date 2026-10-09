"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, optStr, uuid } from "@/lib/validation";
import { registerPayment, voidPayment } from "./service";

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
