"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { AppError, runAction, type ActionResult } from "@/lib/errors";
import { formObject, uuid } from "@/lib/validation";
import { createUser, deleteUser, resendInvitation, setUserSignatures, updateUser, type InviteResult } from "./service";

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

export async function deleteUserAction(id: string, _: ActionResult<unknown> | null, _fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    await deleteUser(actor, uuid.parse(id));
  }, "Usuario eliminado.");
  if (res.ok) revalidatePath("/usuarios");
  return res;
}

const MAX_HTML_BYTES = 100 * 1024;
const MAX_PNG_BYTES = 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** Quita scripts y atributos de evento: la firma se incrusta en correos. */
function cleanSignatureHtml(raw: string) {
  return raw
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<\/?(html|head|body|title|meta)[^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .trim();
}

export async function updateUserSignaturesAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    const input: { signatureHtml?: string | null; quoteBlock?: Buffer | null } = {};
    const html = fd.get("signatureFile");
    const png = fd.get("blockFile");
    if (fd.get("clearHtml")) input.signatureHtml = null;
    else if (html instanceof File && html.size > 0) {
      if (html.size > MAX_HTML_BYTES) throw new AppError("La firma de correo no puede pesar más de 100 KB.", "VALIDATION");
      const text = cleanSignatureHtml(await html.text());
      if (!text) throw new AppError("El archivo de firma está vacío.", "VALIDATION");
      input.signatureHtml = text;
    }
    if (fd.get("clearBlock")) input.quoteBlock = null;
    else if (png instanceof File && png.size > 0) {
      if (png.size > MAX_PNG_BYTES) throw new AppError("El bloque de asesor no puede pesar más de 1 MB.", "VALIDATION");
      const buf = Buffer.from(await png.arrayBuffer());
      if (!buf.subarray(0, 4).equals(PNG_MAGIC)) throw new AppError("El bloque de asesor debe ser una imagen PNG.", "VALIDATION");
      input.quoteBlock = buf;
    }
    if (Object.keys(input).length === 0) throw new AppError("Selecciona un archivo o marca quitar.", "VALIDATION");
    await setUserSignatures(actor, uuid.parse(id), input);
  }, "Firmas guardadas.");
  if (res.ok) revalidatePath("/usuarios");
  return res;
}

