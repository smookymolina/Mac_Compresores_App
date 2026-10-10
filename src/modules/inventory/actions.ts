"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError, runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, formObject, uuid } from "@/lib/validation";
import { registerMovement, reverseMovement, setMinStock, setWarehouseActive } from "./service";

const movementSchema = z.object({
  sku: z.string().trim().min(1),
  warehouseId: uuid,
  type: z.enum(["IN", "OUT", "ADJUST"]),
  quantity: decimalStr({ scale: 3 }),
  reason: z.string().trim().min(3).max(300),
  minStock: decimalStr({ min: 0, scale: 3 }).optional().or(z.literal("").transform(() => undefined)),
});

async function productIdBySku(sku: string) {
  const p = await db.product.findUnique({ where: { sku: sku.toUpperCase() }, select: { id: true } });
  if (!p) throw new AppError(`No existe el SKU ${sku}.`, "NOT_FOUND");
  return p.id;
}

export async function movementAction(_: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("inventory.write");
    const d = movementSchema.parse(formObject(fd));
    const productId = await productIdBySku(d.sku);
    await registerMovement(user, { productId, warehouseId: d.warehouseId, type: d.type, quantity: d.quantity, reason: d.reason });
    if (d.minStock !== undefined) await setMinStock(user, productId, d.warehouseId, d.minStock);
  }, "Movimiento registrado.");
  if (res.ok) revalidatePath("/inventario");
  return res;
}

export async function reverseMovementAction(movementId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("inventory.write");
    await reverseMovement(user, movementId, z.string().trim().min(3).max(300).parse(fd.get("reason") || "Corrección"));
  }, "Movimiento revertido.");
  if (res.ok) revalidatePath("/inventario");
  return res;
}

export async function createWarehouseAction(_: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("inventory.write");
    const d = z.object({ code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/), name: z.string().trim().min(2).max(100) }).parse(formObject(fd));
    const w = await db.warehouse.create({ data: d });
    await audit({ userId: user.id, action: "warehouse.create", entity: "Warehouse", entityId: w.id });
  }, "Almacén creado.");
  if (res.ok) revalidatePath("/inventario");
  return res;
}

export async function minStockAction(_: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("inventory.write");
    // Nombres propios (min*) para no repetir ids con el formulario de movimientos en la misma página.
    const d = z.object({ minSku: z.string().trim().min(1), minWarehouseId: uuid, minQty: decimalStr({ min: 0, scale: 3 }) }).parse(formObject(fd));
    await setMinStock(user, await productIdBySku(d.minSku), d.minWarehouseId, d.minQty);
  }, "Stock mínimo guardado.");
  if (res.ok) revalidatePath("/inventario");
  return res;
}

export async function setWarehouseActiveAction(id: string, active: boolean, _: ActionResult<unknown> | null) {
  const res = await runAction(async () => {
    const user = await requirePermission("inventory.write");
    await setWarehouseActive(user, uuid.parse(id), active);
  }, active ? "Almacén reactivado." : "Almacén desactivado.");
  if (res.ok) revalidatePath("/inventario");
  return res;
}
