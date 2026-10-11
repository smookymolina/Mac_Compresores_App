"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, formObject, optStr } from "@/lib/validation";
import { db } from "@/lib/db";
import { LINES } from "./lines";
import { currentExchangeRate, saveProduct, setExchangeRate } from "./service";
import { catalogPriceMxn } from "@/modules/quotes/pricing";

const productSchema = z.object({
  sku: z.string().trim().min(1).max(80),
  description: z.string().trim().min(2).max(300),
  category: optStr,
  line: z.enum(LINES as [string, ...string[]]).transform((v) => v as (typeof LINES)[number]),
  kind: z.enum(["PRODUCT", "SERVICE"]),
  unit: z.string().trim().min(1).max(20),
  oemName: optStr,
  oemPartNumber: optStr,
  supplierCode: optStr,
  cost: decimalStr({ min: 0 }),
  markup: decimalStr({ min: 0, max: 100 }),
  shipping: decimalStr({ min: 0, scale: 2 }),
  consumables: decimalStr({ min: 0, scale: 2 }).default("0"),
  currency: z.enum(["MXN", "USD"]).default("MXN"),
  price: decimalStr({ min: 0, scale: 2 }).optional().or(z.literal("").transform(() => undefined)),
  taxRate: decimalStr({ min: 0, max: 1 }),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export async function saveProductAction(id: string | undefined, _: ActionResult<unknown> | null, fd: FormData) {
  let createdId: string | undefined;
  const res = await runAction(async () => {
    const user = await requirePermission("products.write");
    const p = await saveProduct(user, productSchema.parse(formObject(fd)), id);
    createdId = p.id;
  }, "Producto guardado.");
  if (res.ok) {
    revalidatePath("/productos");
    if (!id && createdId) redirect(`/productos/${createdId}`);
  }
  return res;
}

/** Búsqueda ligera para el editor de cotizaciones. */
export async function searchProductsAction(term: string) {
  await requirePermission("products.read");
  const q = term.trim();
  if (q.length < 2) return [];
  const rows = await db.product.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { sku: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { oemPartNumber: { contains: q, mode: "insensitive" } },
        { supplierCode: { contains: q, mode: "insensitive" } },
      ],
    },
    select: { id: true, sku: true, description: true, unit: true, price: true, currency: true, taxRate: true, kind: true },
    orderBy: { sku: "asc" },
    take: 15,
  });
  const fx = (await currentExchangeRate())?.rate ?? null;
  // Precio en MXN (la tubería en USD se convierte con el TC vigente); null = falta TC.
  return rows.map((r) => ({
    ...r,
    price: r.currency === "USD" && !fx ? "0" : catalogPriceMxn(r, fx).toString(),
    priceUsd: r.currency === "USD" ? r.price.toString() : null,
    taxRate: r.taxRate.toString(),
  }));
}

export async function setExchangeRateAction(_: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("products.write");
    await setExchangeRate(user, decimalStr({ min: 0.0001, scale: 4 }).parse(fd.get("rate")));
  }, "Tipo de cambio actualizado.");
  if (res.ok) revalidatePath("/productos");
  return res;
}
