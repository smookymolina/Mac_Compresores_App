"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { formObject, uuid } from "@/lib/validation";
import { createUser, resendInvitation, updateUser, type InviteResult } from "./service";

const password = z.string().min(10, "Mínimo 10 caracteres").max(100);

const NOT_MAILED = "no se pudo enviar el correo de invitación (revisa la configuración de correo) y puedes reenviarla desde la lista.";

/** Mensaje para quien invita: el usuario existe aunque el correo no haya salido. */
const inviteMessage = (r: InviteResult, ok: string, failPrefix: string) => (r.mailed ? ok : `${failPrefix} ${NOT_MAILED}`);

export async function createUserAction(_: ActionResult<unknown> | null, fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    const d = z.object({
      name: z.string().trim().min(2).max(100),
      email: z.string().trim().email("Correo inválido").max(200),
      roleId: uuid,
    }).parse(formObject(fd));
    return createUser(actor, d);
  });
  if (!res.ok) return res;
  revalidatePath("/usuarios");
  return { ok: true, message: inviteMessage(res.data!, "Usuario creado. Le enviamos la invitación por correo.", "Usuario creado, pero") };
}

export async function resendInvitationAction(id: string, _: ActionResult<unknown> | null, _fd: FormData): Promise<ActionResult<unknown>> {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    return resendInvitation(actor, uuid.parse(id));
  });
  if (!res.ok) return res;
  revalidatePath("/usuarios");
  return res.data!.mailed
    ? { ok: true, message: "Invitación reenviada." }
    : { ok: false, error: "No se pudo enviar el correo de invitación. Revisa la configuración de correo e inténtalo de nuevo." };
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
