import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { pageArgs, paged } from "@/lib/pagination";
import { audit, deviceData, type SyncMeta } from "@/lib/audit";
import { AppError } from "@/lib/errors";
import { can, type CurrentUser } from "@/lib/auth/session";
import { dec } from "@/lib/money";

/** Ventas solo ve clientes propios o sin asignar; gerencia/admin ven todos. */
export function customerScope(user: CurrentUser): Prisma.CustomerWhereInput {
  // Ventas solo ve sus propios clientes; gerencia y administración ven todos.
  return can(user, "quotes.read_all") ? {} : { ownerId: user.id };
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
  address?: { label?: string; street: string; city?: string; state?: string; zip?: string };
}

/** Campos escalares de cliente que la app móvil puede fusionar uno por uno (`changedFields`). */
export const CUSTOMER_FIELDS = ["legalName", "rfc", "email", "phone", "paymentTermsDays", "creditLimit", "notes", "ownerId"] as const;
export type CustomerField = (typeof CUSTOMER_FIELDS)[number];

/** Opciones de la app móvil: `changedFields` aplica solo esos campos (última edición gana, §5.2). */
export interface SaveCustomerOpts extends SyncMeta {
  createId?: string;
  changedFields?: CustomerField[];
  baseUpdatedAt?: Date;
}

/**
 * Crea (`id` vacío) o actualiza un cliente. La app móvil puede mandar `opts.createId` (UUID del teléfono):
 * si ya existe ese cliente (reintento) se devuelve sin cambios.
 */
export async function saveCustomer(user: CurrentUser, input: CustomerInput, id?: string, opts: SaveCustomerOpts = {}) {
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
      if (opts.changedFields) {
        const fields = [...new Set(opts.changedFields)];
        const merged = Object.fromEntries(fields.map((f) => [f, (data as Record<CustomerField, unknown>)[f]])) as Prisma.CustomerUncheckedUpdateInput;
        const c = fields.length ? await tx.customer.update({ where: { id }, data: merged }) : prev;
        await audit({ userId: user.id, action: "customer.merge", entity: "Customer", entityId: id, data: {
          fields, serverChangedSinceBase: !!opts.baseUpdatedAt && prev.updatedAt > opts.baseUpdatedAt,
          ...(opts.baseUpdatedAt && { baseUpdatedAt: opts.baseUpdatedAt.toISOString() }), ...deviceData(opts.deviceId, opts.capturedAt),
        } }, tx);
        return c;
      }
      const c = await tx.customer.update({ where: { id }, data });
      await audit({ userId: user.id, action: "customer.update", entity: "Customer", entityId: id,
        data: deviceData(opts.deviceId, opts.capturedAt) }, tx);
      return c;
    }
    if (opts.createId) {
      const prev = await tx.customer.findUnique({ where: { id: opts.createId } });
      if (prev) {
        if (!(await tx.customer.findFirst({ where: { AND: [{ id: opts.createId }, customerScope(user)] }, select: { id: true } })))
          throw new AppError("El identificador del cliente ya está en uso.", "CONFLICT");
        return prev;
      }
    }
    const c = await tx.customer.create({
      data: {
        id: opts.createId,
        ...data,
        contacts: input.contact?.name ? { create: input.contact } : undefined,
        addresses: input.address?.street ? { create: input.address } : undefined,
      },
    });
    await audit({ userId: user.id, action: "customer.create", entity: "Customer", entityId: c.id,
      data: deviceData(opts.deviceId, opts.capturedAt) }, tx);
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

/**
 * Opciones de la app móvil para contactos y direcciones: `id` del teléfono (agregar el mismo `id` otra vez
 * devuelve el existente) e `idempotent` (quitar uno que ya no existe no es error).
 */
export interface ChildOpts extends SyncMeta { id?: string; idempotent?: boolean }

const sameIdInUse = () => new AppError("El identificador ya está en uso en otro cliente.", "CONFLICT");

export async function addContact(user: CurrentUser, customerId: string, contact: NonNullable<CustomerInput["contact"]>, opts: ChildOpts = {}) {
  await writableCustomer(user, customerId);
  if (opts.id) {
    const prev = await db.customerContact.findUnique({ where: { id: opts.id } });
    if (prev) { if (prev.customerId !== customerId) throw sameIdInUse(); return prev; }
  }
  const ct = await db.customerContact.create({ data: { ...contact, id: opts.id, customerId } });
  await audit({ userId: user.id, action: "customer.contact.add", entity: "Customer", entityId: customerId,
    data: { contactId: ct.id, name: ct.name, ...deviceData(opts.deviceId, opts.capturedAt) } });
  return ct;
}

export async function addAddress(user: CurrentUser, customerId: string, address: NonNullable<CustomerInput["address"]>, opts: ChildOpts = {}) {
  await writableCustomer(user, customerId);
  if (opts.id) {
    const prev = await db.customerAddress.findUnique({ where: { id: opts.id } });
    if (prev) { if (prev.customerId !== customerId) throw sameIdInUse(); return prev; }
  }
  const a = await db.customerAddress.create({ data: { ...address, id: opts.id, customerId } });
  await audit({ userId: user.id, action: "customer.address.add", entity: "Customer", entityId: customerId,
    data: { addressId: a.id, ...deviceData(opts.deviceId, opts.capturedAt) } });
  return a;
}

export async function removeContact(user: CurrentUser, customerId: string, contactId: string, opts: ChildOpts = {}) {
  await writableCustomer(user, customerId);
  const res = await db.customerContact.deleteMany({ where: { id: contactId, customerId } });
  if (res.count === 0) {
    if (opts.idempotent) return;
    throw new AppError("Contacto no encontrado.", "NOT_FOUND");
  }
  await audit({ userId: user.id, action: "customer.contact.remove", entity: "Customer", entityId: customerId,
    data: { contactId, ...deviceData(opts.deviceId, opts.capturedAt) } });
}

export async function removeAddress(user: CurrentUser, customerId: string, addressId: string, opts: ChildOpts = {}) {
  await writableCustomer(user, customerId);
  const res = await db.customerAddress.deleteMany({ where: { id: addressId, customerId } });
  if (res.count === 0) {
    if (opts.idempotent) return;
    throw new AppError("Dirección no encontrada.", "NOT_FOUND");
  }
  await audit({ userId: user.id, action: "customer.address.remove", entity: "Customer", entityId: customerId,
    data: { addressId, ...deviceData(opts.deviceId, opts.capturedAt) } });
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
