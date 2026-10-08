import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pageArgs, paged } from "@/lib/pagination";
import { audit } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { dec } from "@/lib/money";

/** Ventas solo ve clientes propios o sin asignar; gerencia/admin ven todos. */
export function customerScope(user: CurrentUser): Prisma.CustomerWhereInput {
  return can(user, "quotes.read_all") ? {} : { OR: [{ ownerId: user.id }, { ownerId: null }] };
}

/** Listado paginado para la vista de clientes. */
export async function pageCustomers(user: CurrentUser, q: { search?: string; page?: number }) {
  const { page, skip, take } = pageArgs(q.page);
  const where: Prisma.CustomerWhereInput = {
    AND: [
      customerScope(user),
      q.search
        ? { OR: [{ legalName: { contains: q.search, mode: "insensitive" } }, { rfc: { contains: q.search, mode: "insensitive" } }] }
        : {},
    ],
  };
  const [items, total] = await Promise.all([
    db.customer.findMany({
      where,
      include: { owner: { select: { name: true } }, _count: { select: { quotes: true, sales: true } } },
      orderBy: { legalName: "asc" },
      skip,
      take,
    }),
    db.customer.count({ where }),
  ]);
  return paged(items, total, page);
}

/** Lista corta para selectores (p. ej. cliente de una cotización). */
export async function listCustomers(user: CurrentUser, search?: string) {
  return db.customer.findMany({
    where: {
      AND: [
        customerScope(user),
        search
          ? { OR: [{ legalName: { contains: search, mode: "insensitive" } }, { rfc: { contains: search, mode: "insensitive" } }] }
          : {},
      ],
    },
    include: { owner: { select: { name: true } }, _count: { select: { quotes: true, sales: true } } },
    orderBy: { legalName: "asc" },
    take: 200,
  });
}

export async function getCustomer(user: CurrentUser, id: string) {
  const c = await db.customer.findFirst({
    where: { AND: [{ id }, customerScope(user)] },
    include: {
      contacts: true,
      addresses: true,
      owner: { select: { id: true, name: true } },
      quotes: { orderBy: { createdAt: "desc" }, take: 20 },
      sales: { orderBy: { confirmedAt: "desc" }, take: 20 },
    },
  });
  if (!c) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
  return c;
}

export interface CustomerInput {
  legalName: string;
  rfc?: string;
  email?: string;
  phone?: string;
  paymentTermsDays: number;
  creditLimit?: string;
  notes?: string;
  ownerId?: string;
  contact?: { name: string; position?: string; email?: string; phone?: string };
  address?: { street: string; city?: string; state?: string; zip?: string };
}

export async function saveCustomer(user: CurrentUser, input: CustomerInput, id?: string) {
  const isManager = can(user, "quotes.read_all");
  const data = {
    legalName: input.legalName,
    rfc: input.rfc ? input.rfc.toUpperCase() : null,
    email: input.email || null,
    phone: input.phone || null,
    paymentTermsDays: input.paymentTermsDays,
    creditLimit: input.creditLimit ? dec(input.creditLimit) : null,
    notes: input.notes || null,
    // Un vendedor no puede reasignar clientes.
    ownerId: isManager ? input.ownerId || null : user.id,
  };

  return db.$transaction(async (tx) => {
    if (id) {
      const prev = await tx.customer.findFirst({ where: { AND: [{ id }, customerScope(user)] } });
      if (!prev) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
      if (!isManager && prev.ownerId && prev.ownerId !== user.id) throw new AppError("Cliente asignado a otro vendedor.", "FORBIDDEN");
      const c = await tx.customer.update({ where: { id }, data });
      await audit({ userId: user.id, action: "customer.update", entity: "Customer", entityId: id }, tx);
      return c;
    }
    const c = await tx.customer.create({
      data: {
        ...data,
        contacts: input.contact?.name ? { create: input.contact } : undefined,
        addresses: input.address?.street ? { create: input.address } : undefined,
      },
    });
    await audit({ userId: user.id, action: "customer.create", entity: "Customer", entityId: c.id }, tx);
    return c;
  });
}

export async function addContact(user: CurrentUser, customerId: string, contact: NonNullable<CustomerInput["contact"]>) {
  await getCustomer(user, customerId);
  await db.customerContact.create({ data: { ...contact, customerId } });
}

export async function addAddress(user: CurrentUser, customerId: string, address: NonNullable<CustomerInput["address"]>) {
  await getCustomer(user, customerId);
  await db.customerAddress.create({ data: { ...address, customerId } });
}
