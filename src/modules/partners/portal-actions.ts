"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, runAction, type ActionResult } from "@/lib/errors";
import { clientIp } from "@/lib/request";
import { clear, hit } from "@/lib/rate-limit";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { logPartnerActivity } from "./activity";
import { consumeBackupCode, generateBackupCodes, MAX_FAILED_LOGINS, newTotpSecret, registerFailure, verifyPartnerPassword, verifyTotp } from "./auth";
import { encryptSecret } from "./crypto";
import { checkLimits, registerBurst } from "./guard";
import { cleanSearchTerm, PARTNER_SEARCH_MIN, searchPartnerProducts } from "./search";
import {
  clearPendingPartner, createPartnerSession, PARTNER_PRE_TTL_MS, destroyPartnerSession, getCurrentPartner, getPendingPartner,
  requirePartnerAction, setPendingPartner,
} from "./session";
import { detectSweep } from "./sweep";
import { signPriceToken } from "./token";

const SWEEP_WINDOW = 8;
const TOTP_WINDOW_MS = 15 * 60_000;

async function reqCtx() {
  const h = await headers();
  return { ip: clientIp(h), userAgent: h.get("user-agent") };
}

const loginSchema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

/** Paso 1: correo + contraseña. Con éxito fija la cookie previa y redirige a /socios/2fa. */
export async function partnerLoginAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const parsed = loginSchema.safeParse({ email: fd.get("email"), password: fd.get("password") });
  if (!parsed.success) return { ok: false, error: "Correo o contraseña inválidos." };
  const ctx = await reqCtx();
  const res = await runAction(async () => {
    const { id } = await verifyPartnerPassword(parsed.data.email, parsed.data.password, ctx);
    await setPendingPartner(id);
    return undefined;
  });
  if (res.ok) redirect("/socios/2fa");
  return res;
}

/**
 * Alta del 2FA (solo si aún no está activo): genera el secreto (cifrado en BD) y los 10 códigos de respaldo.
 * Devuelve QR (data URL), clave manual y códigos UNA sola vez; el 2FA queda activo al confirmar un código en partnerTotpVerifyAction.
 */
export async function partnerTotpSetupAction(): Promise<ActionResult<{ qr: string; secret: string; backupCodes: string[] }>> {
  return runAction(async () => {
    const pending = await getPendingPartner();
    if (!pending) throw new AppError("Tu sesión de acceso expiró. Inicia sesión de nuevo.", "UNAUTHENTICATED");
    if (pending.totpEnabledAt) throw new AppError("La verificación en dos pasos ya está activa.", "CONFLICT");
    // Un alta cada 10 min por socio: un tercero con la contraseña temporal no puede regenerar el secreto
    // a mitad del alta del socio legítimo (y deja rastro).
    if ((await hit(`ptotpsetup:${pending.id}`, PARTNER_PRE_TTL_MS)) > 1) {
      throw new AppError("Ya se generó un código QR hace unos minutos. Usa ese o espera 10 minutos.", "CONFLICT");
    }
    const { secret, uri } = newTotpSecret(pending.email);
    const codes = await generateBackupCodes();
    await db.partner.update({ where: { id: pending.id }, data: { totpSecretEnc: encryptSecret(secret), backupCodes: codes.hashes, totpLastStep: null } });
    const qr = await QRCode.toDataURL(uri, { margin: 1, width: 240, errorCorrectionLevel: "M" });
    return { qr, secret, backupCodes: codes.plain };
  });
}

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });

/**
 * Paso 2: código TOTP (o de respaldo). Si el 2FA aún no estaba activo, el código TOTP lo confirma y lo activa.
 * Con éxito crea la sesión y redirige a /socios. Los fallos cuentan para el bloqueo (5).
 */
export async function partnerTotpVerifyAction(_: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const ctx = await reqCtx();
  const res = await runAction(async () => {
    const { code } = codeSchema.parse({ code: fd.get("code") });
    const pending = await getPendingPartner();
    if (!pending) throw new AppError("Tu sesión de acceso expiró. Inicia sesión de nuevo.", "UNAUTHENTICATED");
    const p = await db.partner.findUnique({ where: { id: pending.id }, select: { id: true, totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true, backupCodes: true } });
    if (!p) throw new AppError("Tu sesión de acceso expiró. Inicia sesión de nuevo.", "UNAUTHENTICATED");
    if (!p.totpEnabledAt && !p.totpSecretEnc) throw new AppError("Primero configura la verificación en dos pasos.");
    // El intento se reserva antes de verificar: un lote en paralelo no puede probar más de 5 códigos.
    if ((await hit(`p2fa:${p.id}`, TOTP_WINDOW_MS)) > MAX_FAILED_LOGINS) throw new AppError("Demasiados intentos. Espera 15 minutos.", "FORBIDDEN");

    const digits = code.replace(/\s/g, "");
    const isTotp = /^\d{6}$/.test(digits);
    // Un código de respaldo solo sirve si el 2FA ya está activo (el alta exige demostrar el dispositivo con TOTP).
    const ok = isTotp ? await verifyTotp(p, digits) : p.totpEnabledAt ? await consumeBackupCode(p, code) : false;
    if (!ok) {
      await logPartnerActivity({ partnerId: p.id, type: "TOTP_FAIL", meta: { method: isTotp ? "totp" : "backup" }, ...ctx });
      const blocked = await registerFailure(p.id, ctx);
      throw new AppError(blocked ? "Tu cuenta fue bloqueada por intentos fallidos. Contacta a MAC Compresores." : "Código incorrecto. Intenta de nuevo.", blocked ? "FORBIDDEN" : "VALIDATION");
    }
    // Pudo bloquearse por otra petición en paralelo mientras se verificaba este código.
    const now = await db.partner.findUnique({ where: { id: p.id }, select: { status: true } });
    if (now?.status !== "ACTIVE") throw new AppError("Tu cuenta está bloqueada. Contacta a MAC Compresores.", "FORBIDDEN");
    await clear(`p2fa:${p.id}`);
    if (!p.totpEnabledAt) {
      await db.partner.update({ where: { id: p.id }, data: { totpEnabledAt: new Date() } });
      await logPartnerActivity({ partnerId: p.id, type: "TOTP_SETUP", ...ctx });
      const admins = await usersWithPermission("partners.manage");
      await notify(admins.map((u) => u.id), {
        kind: "partner.totp_setup", title: `${pending.name} activó su verificación en dos pasos`,
        body: `IP ${ctx.ip}. Si no fue el socio, restablece su 2FA.`, href: `/socios-admin/${p.id}`,
      });
    } else if (!isTotp) {
      await logPartnerActivity({ partnerId: p.id, type: "BACKUP_CODE_USED", meta: { remaining: p.backupCodes.length - 1 }, ...ctx });
    }
    await logPartnerActivity({ partnerId: p.id, type: "TOTP_OK", ...ctx });
    await db.partner.update({ where: { id: p.id }, data: { failedLogins: 0 } });
    await createPartnerSession(p.id, ctx);
    await clearPendingPartner();
    return undefined;
  });
  if (res.ok) redirect("/socios");
  return res;
}

export async function partnerLogoutAction() {
  const cur = await getCurrentPartner();
  if (cur) await logPartnerActivity({ partnerId: cur.partner.id, type: "LOGOUT", ...(await reqCtx()) });
  await destroyPartnerSession();
  await clearPendingPartner();
  redirect("/socios/login");
}

export interface PartnerSearchItem {
  key: string;
  sku: string;
  description: string;
  unit: string;
  currency: string;
  /** URL del PNG firmado (60 s) con el precio; el precio nunca viaja como texto. */
  img: string;
}

/** Búsqueda de precios. Aplica límites (IP, minuto, cuota), detecta barridos y registra SEARCH. */
export async function searchPricesAction(term: string): Promise<ActionResult<{ items: PartnerSearchItem[]; remaining: number }>> {
  return runAction(async () => {
    const { partner, sessionId } = await requirePartnerAction();
    const q = cleanSearchTerm(typeof term === "string" ? term : "");
    if (q.length < PARTNER_SEARCH_MIN) throw new AppError(`Escribe al menos ${PARTNER_SEARCH_MIN} caracteres.`);
    const ctx = await reqCtx();

    const { remaining } = await checkLimits(partner, ctx.ip);

    // Barrido: últimas búsquedas (de la más antigua a la más reciente) + la actual.
    const recent = await db.partnerActivity.findMany({
      where: { partnerId: partner.id, type: "SEARCH" }, orderBy: { createdAt: "desc" }, take: SWEEP_WINDOW - 1, select: { meta: true },
    });
    const terms = [...recent.reverse().map((r) => String((r.meta as { term?: unknown } | null)?.term ?? "")), q];
    const sweep = detectSweep(terms);
    if (sweep.suspect) {
      await logPartnerActivity({ partnerId: partner.id, type: "SWEEP_SUSPECT", meta: { reason: sweep.reason ?? "", run: sweep.run, term: q }, ...ctx });
      const bursts = await registerBurst(partner.id, "barrido", ctx.ip);
      if (bursts > 3) throw new AppError("Tu acceso fue bloqueado por actividad inusual. Contacta a MAC Compresores.", "FORBIDDEN");
    }

    const rows = await searchPartnerProducts(q);
    await logPartnerActivity({ partnerId: partner.id, type: "SEARCH", meta: { term: q, count: rows.length }, ...ctx });
    const items: PartnerSearchItem[] = rows.map((r) => ({
      key: r.id, sku: r.sku, description: r.description, unit: r.unit, currency: r.currency,
      img: `/socios/p/${signPriceToken({ productId: r.id, partnerId: partner.id, sessionId })}`,
    }));
    return { items, remaining };
  });
}
