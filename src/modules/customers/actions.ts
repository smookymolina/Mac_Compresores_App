"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { decimalStr, formObject, optStr, uuid } from "@/lib/validation";
import { addAddress, addContact, removeAddress, removeContact, saveCustomer, setCustomerActive } from "./service";

// RFC persona moral (12) o física (13).
const rfc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/, "RFC inválido")
  .optional()
  .or(z.literal("").transform(() => undefined));

const customerSchema = z.object({
  legalName: z.string().trim().min(2).max(200),
  rfc,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: optStr,
  paymentTermsDays: z.coerce.number().int().min(0).max(365),
  creditLimit: decimalStr({ min: 0, scale: 2 }).optional().or(z.literal("").transform(() => undefined)),
  notes: z.string().trim().max(2000).optional(),
  ownerId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
});

const contactSchema = z.object({
  name: z.string().trim().min(2).max(120),
  position: optStr,
  email: z.string().trim().email().optional().or(z.literal("").transform(() => undefined)),
  phone: optStr,
});

const addressSchema = z.object({
  street: z.string().trim().min(3).max(300),
  city: optStr,
  state: optStr,
  zip: optStr,
});

export async function saveCustomerAction(id: string | undefined, _: ActionResult<unknown> | null, fd: FormData) {
  let newId: string | undefined;
  const res = await runAction(async () => {
    const user = await requirePermission("customers.write");
    const raw = formObject(fd);
    const data = customerSchema.parse(raw);
    const contact = !id && raw.contactName ? contactSchema.parse({ name: raw.contactName, email: raw.contactEmail, phone: raw.contactPhone }) : undefined;
    const address = !id && raw.street ? addressSchema.parse({ street: raw.street, city: raw.city, state: raw.state, zip: raw.zip }) : undefined;
    newId = (await saveCustomer(user, { ...data, contact, address }, id)).id;
  }, "Cliente guardado.");
  if (res.ok) {
    revalidatePath("/clientes");
    if (!id && newId) redirect(`/clientes/${newId}`);
  }
  return res;
}

export async function addContactAction(customerId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("customers.write");
    await addContact(user, customerId, contactSchema.parse(formObject(fd)));
  }, "Contacto agregado.");
  if (res.ok) revalidatePath(`/clientes/${customerId}`);
  return res;
}

export async function addAddressAction(customerId: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const user = await requirePermission("customers.write");
    await addAddress(user, customerId, addressSchema.parse(formObject(fd)));
  }, "Dirección agregada.");
  if (res.ok) revalidatePath(`/clientes/${customerId}`);
  return res;
}

export async function removeContactAction(customerId: string, contactId: string, _: ActionResult<unknown> | null) {
  const res = await runAction(async () => {
    const user = await requirePermission("customers.write");
    await removeContact(user, uuid.parse(customerId), uuid.parse(contactId));
  }, "Contacto eliminado.");
  if (res.ok) revalidatePath(`/clientes/${customerId}`);
  return res;
}

export async function removeAddressAction(customerId: string, addressId: string, _: ActionResult<unknown> | null) {
  const res = await runAction(async () => {
    const user = await requirePermission("customers.write");
    await removeAddress(user, uuid.parse(customerId), uuid.parse(addressId));
  }, "Dirección eliminada.");
  if (res.ok) revalidatePath(`/clientes/${customerId}`);
  return res;
}

export async function setCustomerActiveAction(customerId: string, active: boolean, _: ActionResult<unknown> | null) {
  const res = await runAction(async () => {
    const user = await requirePermission("customers.write");
    await setCustomerActive(user, uuid.parse(customerId), active);
  }, active ? "Cliente reactivado." : "Cliente desactivado.");
  if (res.ok) {
    revalidatePath("/clientes");
    revalidatePath(`/clientes/${customerId}`);
  }
  return res;
}
