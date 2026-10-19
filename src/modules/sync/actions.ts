"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/session";
import { runAction, type ActionResult } from "@/lib/errors";
import { uuid } from "@/lib/validation";
import { rejectSyncConflict, resolvePriceConflict, retrySyncConflict, revokeDevice, resolveSyncIssue, setMobileAccess, type PriceResolution } from "./admin";

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

const RESOLVED: Record<PriceResolution, string> = {
  server: "Cotización aplicada con los precios vigentes.",
  client: "Cotización aplicada con los precios del teléfono.",
  reject: "Operación rechazada.",
};

export async function resolvePriceConflictAction(id: string, mode: PriceResolution, _: ActionResult<unknown> | null, _fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission(mode === "client" ? "quotes.override_price" : "users.manage");
    await resolvePriceConflict(actor, uuid.parse(id), z.enum(["server", "client", "reject"]).parse(mode));
  }, RESOLVED[mode] ?? "Listo.");
  if (res.ok) { revalidatePath("/sincronizacion"); revalidatePath("/cotizaciones"); }
  return res;
}

const revalidateResolved = () => {
  for (const p of ["/sincronizacion", "/ventas", "/inventario", "/clientes", "/cotizaciones"]) revalidatePath(p);
};

/** «Reintentar» un conflicto; con `warehouseId` en el formulario, «Convertir desde otro almacén». */
export async function retrySyncConflictAction(id: string, _: ActionResult<unknown> | null, fd: FormData) {
  const raw = fd.get("warehouseId");
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    const warehouseId = raw ? uuid.parse(raw) : undefined;
    await retrySyncConflict(actor, uuid.parse(id), { warehouseId });
  }, raw ? "Venta aplicada desde el almacén elegido." : "Operación aplicada.");
  if (res.ok) revalidateResolved();
  return res;
}

export async function rejectSyncConflictAction(id: string, _: ActionResult<unknown> | null, _fd: FormData) {
  const res = await runAction(async () => {
    const actor = await requirePermission("users.manage");
    await rejectSyncConflict(actor, uuid.parse(id));
  }, "Operación rechazada. Se avisó al vendedor.");
  if (res.ok) revalidatePath("/sincronizacion");
  return res;
}
