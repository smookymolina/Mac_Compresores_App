import type { Prisma, ProductKind, ProductLine, ProductStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { dec, listPrice } from "@/lib/money";
import type { CurrentUser } from "@/lib/auth/session";
import { parseProductCsv } from "./import";

export const PAGE_SIZE = 50;

export async function listProducts(q: { search?: string; line?: ProductLine; status?: ProductStatus; page?: number }) {
  const where: Prisma.ProductWhereInput = {
    ...(q.line && { line: q.line }),
    ...(q.status && { status: q.status }),
    ...(q.search && {
      OR: [
        { sku: { contains: q.search, mode: "insensitive" } },
        { description: { contains: q.search, mode: "insensitive" } },
        { oemPartNumber: { contains: q.search, mode: "insensitive" } },
        { supplierCode: { contains: q.search, mode: "insensitive" } },
      ],
    }),
  };
  const page = Math.max(1, q.page ?? 1);
  const [items, total] = await Promise.all([
    db.product.findMany({
      where,
      include: { category: true },
      orderBy: { sku: "asc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.product.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

export interface ProductInput {
  sku: string;
  description: string;
  category?: string;
  line: ProductLine;
  kind: ProductKind;
  unit: string;
  oemName?: string;
  oemPartNumber?: string;
  supplierCode?: string;
  cost: string;
  markup: string;
  shipping: string;
  price?: string;
  taxRate: string;
  status: ProductStatus;
}

async function categoryId(name?: string) {
  if (!name) return null;
  const c = await db.category.upsert({ where: { name }, create: { name }, update: {} });
  return c.id;
}

export async function saveProduct(user: CurrentUser, input: ProductInput, id?: string) {
  const price = input.price ? dec(input.price) : listPrice(input.cost, input.markup, input.shipping);
  const data = {
    sku: input.sku.toUpperCase(),
    description: input.description,
    categoryId: await categoryId(input.category),
    line: input.line,
    kind: input.kind,
    unit: input.unit,
    oemName: input.oemName || null,
    oemPartNumber: input.oemPartNumber || null,
    supplierCode: input.supplierCode || null,
    cost: dec(input.cost),
    markup: dec(input.markup),
    shipping: dec(input.shipping),
    price,
    taxRate: dec(input.taxRate),
    status: input.status,
  };

  return db.$transaction(async (tx) => {
    if (id) {
      const prev = await tx.product.findUnique({ where: { id } });
      if (!prev) throw new AppError("Producto no encontrado.", "NOT_FOUND");
      const p = await tx.product.update({ where: { id }, data });
      if (!prev.price.eq(p.price) || !prev.cost.eq(p.cost)) {
        await tx.priceHistory.create({ data: { productId: id, cost: p.cost, price: p.price, changedById: user.id } });
      }
      await audit(
        { userId: user.id, action: "product.update", entity: "Product", entityId: id,
          data: { priceFrom: prev.price.toString(), priceTo: p.price.toString() } },
        tx,
      );
      return p;
    }
    const p = await tx.product.create({ data });
    await tx.priceHistory.create({ data: { productId: p.id, cost: p.cost, price: p.price, changedById: user.id } });
    await audit({ userId: user.id, action: "product.create", entity: "Product", entityId: p.id }, tx);
    return p;
  });
}

/** Importa CSV: crea nuevos y actualiza existentes (registrando historial si cambia precio/costo). */
export async function importProducts(userId: string, csv: string) {
  const { rows, errors } = parseProductCsv(csv);
  if (rows.length === 0) return { created: 0, updated: 0, unchanged: 0, errors };

  const catNames = [...new Set(rows.map((r) => r.category).filter((c): c is string => !!c))];
  await db.category.createMany({ data: catNames.map((name) => ({ name })), skipDuplicates: true });
  const cats = new Map((await db.category.findMany({ select: { id: true, name: true } })).map((c) => [c.name, c.id]));

  const existing = new Map(
    (
      await db.product.findMany({
        where: { sku: { in: rows.map((r) => r.sku) } },
        select: { id: true, sku: true, cost: true, price: true },
      })
    ).map((p) => [p.sku, p]),
  );

  const toData = (r: (typeof rows)[number]) => ({
    sku: r.sku, oemName: r.oemName, oemPartNumber: r.oemPartNumber, supplierCode: r.supplierCode,
    description: r.description, categoryId: r.category ? (cats.get(r.category) ?? null) : null,
    line: r.line, kind: r.kind, unit: r.unit, cost: r.cost, markup: r.markup, shipping: r.shipping,
    price: r.price, taxRate: r.taxRate,
  });

  const fresh = rows.filter((r) => !existing.has(r.sku));
  for (let i = 0; i < fresh.length; i += 1000) {
    await db.product.createMany({ data: fresh.slice(i, i + 1000).map(toData), skipDuplicates: true });
  }

  let updated = 0;
  let unchanged = 0;
  for (const r of rows) {
    const prev = existing.get(r.sku);
    if (!prev) continue;
    if (prev.price.eq(r.price) && prev.cost.eq(r.cost)) {
      unchanged++;
      continue;
    }
    await db.$transaction([
      db.product.update({ where: { id: prev.id }, data: toData(r) }),
      db.priceHistory.create({ data: { productId: prev.id, cost: r.cost, price: r.price, changedById: userId } }),
    ]);
    updated++;
  }

  await audit({
    userId, action: "product.import", entity: "Product",
    data: { created: fresh.length, updated, unchanged, errors: errors.length },
  });
  return { created: fresh.length, updated, unchanged, errors };
}
