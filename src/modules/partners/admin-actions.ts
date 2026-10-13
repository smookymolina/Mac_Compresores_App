"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { requirePermission } from "@/lib/auth/session";
import { AppError, runAction, type ActionResult } from "@/lib/errors";
import { clear } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { decimalStr, formObject, uuid } from "@/lib/validation";
import { logPartnerActivity } from "./activity";
import { generateTempPassword, hashPassword } from "./auth";
import { SETTING_DISCOUNT, SETTING_QUOTA } from "./pricing";

const PERM = "partners.manage" as const;
const pctField = decimalStr({ min: 0, max: 60, scale: 2 });
const quotaField = z.string().trim().regex(/^\d+$/, "Número entero").transform(Number).refine((n) => n >= 1 && n <= 1000, "Entre 1 y 1000");

/** Texto opcional: "" → null (usa el valor global). */
const optional = <T extends z.ZodTypeAny>(f: T) => z.union([z.literal("").transform(() => null), f]).nullish().transform((v) => v ?? null);

const partnerSchema = z.object({
  id: uuid.optional().or(z.literal("").transform(() => undefined)),
  name: z.string().trim().min(2, "Mínimo 2 caracteres").max(120),
  company: z.string().trim().min(2, "Mínimo 2 caracteres").max(160),
  email: z.string().trim().toLowerCase().email("Correo inválido").max(200),
  discountPct: optional(pctField),
  dailyQuota: optional(quotaField),
});

async function adminCtx() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get("user-agent") };
}

/** Bitácora ADMIN_CHANGE del socio + revalidación de las pantallas del admin. */
async function logAdminChange(partnerId: string, userId: string, action: string, changes?: Prisma.InputJsonObject) {
  await logPartnerActivity({ partnerId, type: "ADMIN_CHANGE", meta: { action, by: userId, ...(changes ?? {}) }, ...(await adminCtx()) });
  revalidatePath("/socios-admin");
}

/**
 * Crea o edita un socio. Al crear genera una contraseña temporal que se devuelve UNA sola vez (solo se guarda su hash).
 * `discountPct` y `dailyQuota` vacíos = usa el valor global.
 */
export async function savePartnerAction(_: ActionResult<{ id: string; tempPassword?: string }> | null, fd: FormData): Promise<ActionResult<{ id: string; tempPassword?: string }>> {
  return runAction(async () => {
    const user = await requirePermission(PERM);
    const d = partnerSchema.parse(formObject(fd));
    const data = { name: d.name, company: d.company, email: d.email, discountPct: d.discountPct, dailyQuota: d.dailyQuota };
    const changes = { discountPct: d.discountPct, dailyQuota: d.dailyQuota } satisfies Prisma.InputJsonObject;
    if (d.id) {
      const before = await db.partner.findUnique({ where: { id: d.id }, select: { id: true } });
      if (!before) throw new AppError("Socio no encontrado.", "NOT_FOUND");
      await db.partner.update({ where: { id: d.id }, data });
      await audit({ userId: user.id, action: "partner.update", entity: "Partner", entityId: d.id, data: { email: d.email, name: d.name, company: d.company, ...changes } });
      await logAdminChange(d.id, user.id, "update", changes);
      return { id: d.id };
    }
    const tempPassword = generateTempPassword();
    const p = await db.partner.create({ data: { ...data, passwordHash: await hashPassword(tempPassword), createdById: user.id } });
    await audit({ userId: user.id, action: "partner.create", entity: "Partner", entityId: p.id, data: { email: d.email, name: d.name, company: d.company, ...changes } });
    await logAdminChange(p.id, user.id, "create", changes);
    return { id: p.id, tempPassword };
  }, "Socio guardado.");
}

const statusSchema = z.object({ id: uuid, status: z.enum(["ACTIVE", "BLOCKED"]), reason: z.string().trim().max(300).optional() });

/** Bloquea (revoca sesiones) o desbloquea (limpia fallos y límite de login) a un socio. */
export async function setPartnerStatusAction(input: { id: string; status: "ACTIVE" | "BLOCKED"; reason?: string }): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const user = await requirePermission(PERM);
    const d = statusSchema.parse(input);
    const p = await db.partner.findUnique({ where: { id: d.id }, select: { email: true } });
    if (!p) throw new AppError("Socio no encontrado.", "NOT_FOUND");
    if (d.status === "BLOCKED") {
      const reason = d.reason || "Bloqueado por el administrador";
      await db.partner.update({ where: { id: d.id }, data: { status: "BLOCKED", blockedReason: reason, blockedAt: new Date() } });
      await db.partnerSession.deleteMany({ where: { partnerId: d.id } });
      await audit({ userId: user.id, action: "partner.block", entity: "Partner", entityId: d.id, data: { reason } });
      await logAdminChange(d.id, user.id, "block", { reason });
    } else {
      await db.partner.update({ where: { id: d.id }, data: { status: "ACTIVE", blockedReason: null, blockedAt: null, failedLogins: 0 } });
      await clear(`plogin:${p.email}`);
      await clear(`p2fa:${d.id}`);
      await audit({ userId: user.id, action: "partner.unblock", entity: "Partner", entityId: d.id });
      await logAdminChange(d.id, user.id, "unblock");
    }
    return undefined;
  }, input?.status === "BLOCKED" ? "Socio bloqueado." : "Socio desbloqueado.");
}

/** Borra secreto TOTP y códigos de respaldo y cierra sus sesiones: en su próximo acceso deberá configurar el 2FA de nuevo. */
export async function resetPartner2faAction(input: { id: string }): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const user = await requirePermission(PERM);
    const id = uuid.parse(input.id);
    const res = await db.partner.updateMany({ where: { id }, data: { totpSecretEnc: null, totpEnabledAt: null, totpLastStep: null, backupCodes: [] } });
    if (res.count === 0) throw new AppError("Socio no encontrado.", "NOT_FOUND");
    await db.partnerSession.deleteMany({ where: { partnerId: id } });
    await clear(`ptotpsetup:${id}`);
    await audit({ userId: user.id, action: "partner.reset_2fa", entity: "Partner", entityId: id });
    await logAdminChange(id, user.id, "reset_2fa");
    return undefined;
  }, "Verificación en dos pasos restablecida.");
}

const settingsSchema = z.object({ discountPct: pctField, dailyQuota: quotaField });

/** Descuento global (0–60, 2 decimales) y cuota diaria global (1–1000). */
export async function setGlobalPartnerSettingsAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  return runAction<undefined>(async () => {
    const user = await requirePermission(PERM);
    const d = settingsSchema.parse(formObject(fd));
    const pct = Number(d.discountPct);
    await db.$transaction([
      db.setting.upsert({ where: { key: SETTING_DISCOUNT }, create: { key: SETTING_DISCOUNT, value: pct, updatedById: user.id }, update: { value: pct, updatedById: user.id } }),
      db.setting.upsert({ where: { key: SETTING_QUOTA }, create: { key: SETTING_QUOTA, value: d.dailyQuota, updatedById: user.id }, update: { value: d.dailyQuota, updatedById: user.id } }),
    ]);
    await audit({ userId: user.id, action: "partner.settings", entity: "Setting", data: { discountPct: pct, dailyQuota: d.dailyQuota } });
    revalidatePath("/socios-admin");
    return undefined;
  }, "Ajustes guardados.");
}
