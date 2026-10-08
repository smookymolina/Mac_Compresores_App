"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { formObject, uuid } from "@/lib/validation";
import { createUser, updateUser } from "./service";

const password = z.string().min(10, "Mínimo 10 caracteres").max(100);

export async function createUserAction(_: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    const d = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email(),
      roleId: uuid,
      password,
    }).parse(formObject(fd));
    await createUser(actor, d);
  }, "Usuario creado.");
  if (res.ok) revalidatePath("/usuarios");
  return res;
}

export async function updateUserAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    const raw = formObject(fd);
    const d = z.object({
      name: z.string().trim().min(2).max(100),
      roleId: uuid,
      password: password.optional().or(z.literal("").transform(() => undefined)),
    }).parse(raw);
    await updateUser(actor, id, { ...d, active: raw.active === "on" });
  }, "Usuario actualizado.");
  if (res.ok) revalidatePath("/usuarios");
  return res;
}
