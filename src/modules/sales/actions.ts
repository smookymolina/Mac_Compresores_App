"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr } from "@/lib/validation";
import { cancelSale, setSaleExpenses } from "./service";

export async function cancelSaleAction(saleId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    // Cancelar una venta confirmada es sensible: solo gerencia/admin.
    const user = await requirePermission("commissions.approve");
    await cancelSale(user, saleId, z.string().trim().min(5, "Indica el motivo").max(300).parse(fd.get("reason")));
  }, "Venta cancelada e inventario repuesto.");
  if (res.ok) revalidatePath(`/ventas/${saleId}`);
  return res;
}

export async function setSaleExpensesAction(saleId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("commissions.manage");
    await setSaleExpenses(user, saleId, decimalStr({ min: 0, scale: 2 }).parse(fd.get("expenses")));
  }, "Gastos de la venta guardados.");
  if (res.ok) revalidatePath(`/ventas/${saleId}`);
  return res;
}
