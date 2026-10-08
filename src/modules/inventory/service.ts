import type { MovementType } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { dec, type Dec } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth/session";

interface MovementArgs {
  productId: string;
  warehouseId: string;
  type: MovementType;
  quantity: Dec; // con signo
  reason: string;
  userId: string;
  refType?: string;
  refId?: string;
  reversesId?: string;
}

/**
 * Registra un movimiento y actualiza el saldo dentro de la transacción recibida.
 * Las salidas usan un UPDATE condicionado (quantity >= q) para evitar stock negativo bajo concurrencia.
 */
export async function applyMovement(tx: Tx, m: MovementArgs) {
  if (m.quantity.isZero()) throw new AppError("La cantidad no puede ser cero.");
  const product = await tx.product.findUnique({ where: { id: m.productId }, select: { kind: true, sku: true } });
  if (!product) throw new AppError("Producto no encontrado.", "NOT_FOUND");
  if (product.kind === "SERVICE") throw new AppError(`${product.sku} es un servicio; no maneja inventario.`);

  if (m.quantity.gt(0)) {
    await tx.stockBalance.upsert({
      where: { productId_warehouseId: { productId: m.productId, warehouseId: m.warehouseId } },
      create: { productId: m.productId, warehouseId: m.warehouseId, quantity: m.quantity },
      update: { quantity: { increment: m.quantity } },
    });
  } else {
    const out = m.quantity.abs();
    const res = await tx.stockBalance.updateMany({
      where: { productId: m.productId, warehouseId: m.warehouseId, quantity: { gte: out } },
      data: { quantity: { decrement: out } },
    });
    if (res.count === 0) throw new AppError(`Existencia insuficiente de ${product.sku}.`, "CONFLICT");
  }
  return tx.inventoryMovement.create({ data: m });
}

export async function registerMovement(
  user: CurrentUser,
  input: { productId: string; warehouseId: string; type: "IN" | "OUT" | "ADJUST"; quantity: string; reason: string },
) {
  let q = dec(input.quantity);
  if (input.type === "IN" && q.lte(0)) throw new AppError("Una entrada debe ser positiva.");
  if (input.type === "OUT") q = q.abs().neg();
  return db.$transaction(async (tx) => {
    const mv = await applyMovement(tx, { ...input, quantity: q, userId: user.id });
    await audit({ userId: user.id, action: `inventory.${input.type.toLowerCase()}`, entity: "InventoryMovement",
      entityId: mv.id, data: { quantity: q.toString() } }, tx);
    return mv;
  });
}

/** Corrige un movimiento con su compensatorio; la unicidad de reversesId impide doble reversa. */
export async function reverseMovement(user: CurrentUser, movementId: string, reason: string) {
  return db.$transaction(async (tx) => {
    const orig = await tx.inventoryMovement.findUnique({ where: { id: movementId } });
    if (!orig) throw new AppError("Movimiento no encontrado.", "NOT_FOUND");
    if (orig.type === "REVERSAL") throw new AppError("No se puede revertir una reversa.");
    if (orig.type === "SALE_OUT") throw new AppError("Las salidas por venta se revierten cancelando la venta.");
    const already = await tx.inventoryMovement.findUnique({ where: { reversesId: orig.id } });
    if (already) throw new AppError("Este movimiento ya fue revertido.", "CONFLICT");
    const mv = await applyMovement(tx, {
      productId: orig.productId, warehouseId: orig.warehouseId, type: "REVERSAL",
      quantity: orig.quantity.neg(), reason, userId: user.id, reversesId: orig.id,
    });
    await audit({ userId: user.id, action: "inventory.reverse", entity: "InventoryMovement", entityId: mv.id,
      data: { reverses: orig.id } }, tx);
    return mv;
  });
}

export async function setMinStock(user: CurrentUser, productId: string, warehouseId: string, minStock: string) {
  await db.stockBalance.upsert({
    where: { productId_warehouseId: { productId, warehouseId } },
    create: { productId, warehouseId, minStock: dec(minStock) },
    update: { minStock: dec(minStock) },
  });
  await audit({ userId: user.id, action: "inventory.min_stock", entity: "StockBalance", entityId: productId,
    data: { warehouseId, minStock } });
}

export async function listBalances(q: { warehouseId?: string; search?: string; lowOnly?: boolean }) {
  const rows = await db.stockBalance.findMany({
    where: {
      ...(q.warehouseId && { warehouseId: q.warehouseId }),
      ...(q.search && {
        product: { OR: [{ sku: { contains: q.search, mode: "insensitive" } }, { description: { contains: q.search, mode: "insensitive" } }] },
      }),
    },
    include: { product: { select: { sku: true, description: true, unit: true } }, warehouse: { select: { code: true } } },
    orderBy: [{ product: { sku: "asc" } }],
    take: 300,
  });
  return q.lowOnly ? rows.filter((r) => r.quantity.lte(r.minStock) && r.minStock.gt(0)) : rows;
}

export async function listMovements(q: { productId?: string; take?: number }) {
  return db.inventoryMovement.findMany({
    where: q.productId ? { productId: q.productId } : {},
    include: {
      product: { select: { sku: true } },
      warehouse: { select: { code: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: q.take ?? 100,
  });
}

export async function lowStockCount() {
  const [{ count }] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "StockBalance" WHERE "minStock" > 0 AND quantity <= "minStock"`;
  return Number(count);
}
