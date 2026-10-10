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
export async function pageCustomers(user: CurrentUser, q: { search?: string; page?: number; status?: "active" | "inactive" | "all" }) {
  const { page, skip, take } = pageArgs(q.page);
  const status = q.status ?? "active";
  const where: Prisma.CustomerWhereInput = {
    AND: [
      customerScope(user),
      status === "all" ? {} : { active: status === "active" },
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

/**
 * Lista corta para selectores (p. ej. cliente de una cotización). Solo clientes activos, más los inactivos
 * que aún tienen una cotización en borrador (para no perder el cliente al editarla).
 */
export async function listCustomers(user: CurrentUser, search?: string) {
  return db.customer.findMany({
    where: {
      AND: [
        customerScope(user),
        { OR: [{ active: true }, { quotes: { some: { status: "DRAFT" } } }] },
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

/** Cliente editable por el usuario: dentro de su alcance y, para ventas, propio o sin asignar. */
async function writableCustomer(user: CurrentUser, customerId: string) {
  const c = await db.customer.findFirst({ where: { AND: [{ id: customerId }, customerScope(user)] }, select: { id: true, ownerId: true, active: true } });
  if (!c) throw new AppError("Cliente no encontrado.", "NOT_FOUND");
  if (!can(user, "quotes.read_all") && c.ownerId && c.ownerId !== user.id) throw new AppError("Cliente asignado a otro vendedor.", "FORBIDDEN");
  return c;
}

export async function addContact(user: CurrentUser, customerId: string, contact: NonNullable<CustomerInput["contact"]>) {
  await writableCustomer(user, customerId);
  const ct = await db.customerContact.create({ data: { ...contact, customerId } });
  await audit({ userId: user.id, action: "customer.contact.add", entity: "Customer", entityId: customerId, data: { contactId: ct.id, name: ct.name } });
}

export async function addAddress(user: CurrentUser, customerId: string, address: NonNullable<CustomerInput["address"]>) {
  await writableCustomer(user, customerId);
  const a = await db.customerAddress.create({ data: { ...address, customerId } });
  await audit({ userId: user.id, action: "customer.address.add", entity: "Customer", entityId: customerId, data: { addressId: a.id } });
}

export async function removeContact(user: CurrentUser, customerId: string, contactId: string) {
  await writableCustomer(user, customerId);
  const res = await db.customerContact.deleteMany({ where: { id: contactId, customerId } });
  if (res.count === 0) throw new AppError("Contacto no encontrado.", "NOT_FOUND");
  await audit({ userId: user.id, action: "customer.contact.remove", entity: "Customer", entityId: customerId, data: { contactId } });
}

export async function removeAddress(user: CurrentUser, customerId: string, addressId: string) {
  await writableCustomer(user, customerId);
  const res = await db.customerAddress.deleteMany({ where: { id: addressId, customerId } });
  if (res.count === 0) throw new AppError("Dirección no encontrada.", "NOT_FOUND");
  await audit({ userId: user.id, action: "customer.address.remove", entity: "Customer", entityId: customerId, data: { addressId } });
}

/** Desactiva o reactiva un cliente; uno inactivo conserva su historial pero ya no se ofrece para cotizar. */
export async function setCustomerActive(user: CurrentUser, customerId: string, active: boolean) {
  await writableCustomer(user, customerId);
  await db.$transaction(async (tx) => {
    const res = await tx.customer.updateMany({ where: { id: customerId, active: !active }, data: { active } });
    if (res.count === 0) throw new AppError(active ? "El cliente ya está activo." : "El cliente ya está inactivo.", "CONFLICT");
    await audit({ userId: user.id, action: active ? "customer.activate" : "customer.deactivate", entity: "Customer", entityId: customerId }, tx);
  });
}
