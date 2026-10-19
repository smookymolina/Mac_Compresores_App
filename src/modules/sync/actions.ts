"use server";

import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { revokeDevice, resolveSyncIssue, setMobileAccess } from "./admin";

export async function setMobileAccessAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const enabled = fd.get("mobileAccess") === "on";
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    await setMobileAccess(actor, uuid.parse(id), enabled);
  }, enabled ? "Acceso a la app móvil activado." : "Acceso a la app móvil desactivado. Sus dispositivos quedaron revocados.");
  if (res.ok) { revalidatePath("/usuarios"); revalidatePath("/sincronizacion"); }
  return res;
}

export async function revokeDeviceAction(id: string, _: ActionResult<unknown> | null, _fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    await revokeDevice(actor, uuid.parse(id));
  }, "Dispositivo revocado.");
  if (res.ok) revalidatePath("/sincronizacion");
  return res;
}

export async function resolveSyncIssueAction(id: string, _: ActionResult<unknown> | null, _fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    await resolveSyncIssue(actor, uuid.parse(id));
  }, "Incidencia marcada como revisada.");
  if (res.ok) revalidatePath("/sincronizacion");
  return res;
}
