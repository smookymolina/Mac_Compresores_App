"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { formObject, uuid } from "@/lib/validation";
import { addressSchema, contactSchema, customerSchema } from "./input";
import { addAddress, addContact, removeAddress, removeContact, saveCustomer, setCustomerActive } from "./service";

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
