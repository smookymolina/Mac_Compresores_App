import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { hit } from "@/lib/rate-limit";
import { isMailConfigured, sendMail } from "@/lib/mail";
import { renderEmail } from "@/lib/email-layout";
import { notify, usersWithPermission } from "@/modules/notifications/service";
import { logPartnerActivity } from "./activity";
import { getPartnerSettings } from "./pricing";

export const LIMIT_PER_MIN = 10;
export const LIMIT_PER_IP_MIN = 30;
export const BURST_BLOCK_AFTER = 3;
/** Intentos de consulta con la cuota ya agotada tolerados antes de bloquear (el cliente debería detenerse solo). */
export const QUOTA_OVERRUN_BLOCK_AFTER = 5;
const MIN_MS = 60_000;
const DAY_MS = 24 * 60 * 60_000;

/** Fecha calendario en Ciudad de México (YYYY-MM-DD) para las llaves diarias. */
export const mxDate = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Mexico_City" }).format(d);

export type LimitedPartner = { id: string; dailyQuota: number | null };

const quotaKey = (partnerId: string) => `pday:${partnerId}:${mxDate()}`;
const burstKey = (partnerId: string) => `pburst:${partnerId}:${mxDate()}`;

/**
 * Bloquea al socio de inmediato: status BLOCKED, revoca sesiones, registra AUTO_BLOCK y avisa a quienes tienen
 * `partners.manage` (notificación + correo si hay SMTP). Idempotente: si ya estaba bloqueado no repite nada.
 */
export async function autoBlock(partnerId: string, reason: string, meta?: Prisma.InputJsonValue): Promise<void> {
  const blockedAt = new Date();
  const res = await db.partner.updateMany({
    where: { id: partnerId, status: "ACTIVE" },
    data: { status: "BLOCKED", blockedReason: reason.slice(0, 300), blockedAt },
  });
  await db.partnerSession.deleteMany({ where: { partnerId } });
  if (res.count === 0) return;
  await logPartnerActivity({ partnerId, type: "AUTO_BLOCK", meta: { reason, ...(meta && typeof meta === "object" && !Array.isArray(meta) ? meta : meta === undefined ? {} : { meta }) } });

  const partner = await db.partner.findUnique({ where: { id: partnerId }, select: { name: true, company: true, email: true } });
  if (!partner) return;
  const admins = await usersWithPermission("partners.manage");
  try {
    await notify(admins.map((a) => a.id), {
      kind: "partner_blocked",
      title: `Socio bloqueado: ${partner.name}`,
      body: `${partner.company}. Motivo: ${reason}`,
      href: "/socios-admin/historial",
      dedupeKey: `partner-block:${partnerId}:${blockedAt.getTime()}`,
    });
  } catch (e) {
    console.error("[partners] no se pudo notificar el bloqueo", e instanceof Error ? e.message : e);
  }
  if (!isMailConfigured() || admins.length === 0) return;
  try {
    const { html, text } = renderEmail({
      preheader: `Se bloqueó a ${partner.name} (${partner.company})`,
      eyebrow: "Portal de socios",
      title: "Socio bloqueado automáticamente",
      paragraphs: ["El sistema bloqueó el acceso de un socio por actividad sospechosa. Revisa su bitácora y desbloquéalo si fue un falso positivo."],
      details: [
        { label: "Socio", value: partner.name },
        { label: "Empresa", value: partner.company },
        { label: "Correo", value: partner.email },
        { label: "Motivo", value: reason },
      ],
    });
    await sendMail({ to: admins.map((a) => a.email).join(","), subject: `Socio bloqueado: ${partner.name}`, html, text });
  } catch (e) {
    console.error("[partners] no se pudo enviar el correo de bloqueo", e instanceof Error ? e.message : e);
  }
}

/** Cuenta una ráfaga (consulta demasiado rápida o barrido). Más de 3 en el día → autoBlock. Devuelve el total del día. */
export async function registerBurst(partnerId: string, reason: string, ip?: string | null): Promise<number> {
  const n = await hit(burstKey(partnerId), DAY_MS);
  if (n > BURST_BLOCK_AFTER) await autoBlock(partnerId, `Más de ${BURST_BLOCK_AFTER} ráfagas de consultas en el día`, { lastBurst: reason, bursts: n, ip: ip ?? null });
  return n;
}

/**
 * Aplica los límites de una consulta y consume una unidad de cuota diaria.
 * Lanza AppError con mensaje amigable si algo se excede. Devuelve las consultas restantes del día.
 */
export async function checkLimits(partner: LimitedPartner, ip: string): Promise<{ remaining: number }> {
  if ((await hit(`pip:${ip}`, MIN_MS)) > LIMIT_PER_IP_MIN) {
    await logPartnerActivity({ partnerId: partner.id, type: "RATE_LIMITED", meta: { scope: "ip" }, ip });
    throw new AppError("Demasiadas consultas desde tu conexión. Espera un minuto e intenta de nuevo.");
  }
  if ((await hit(`pmin:${partner.id}`, MIN_MS)) > LIMIT_PER_MIN) {
    await logPartnerActivity({ partnerId: partner.id, type: "RATE_LIMITED", meta: { scope: "minute" }, ip });
    const bursts = await registerBurst(partner.id, "minuto", ip);
    if (bursts > BURST_BLOCK_AFTER) throw new AppError("Tu acceso fue bloqueado por actividad inusual. Contacta a MAC Compresores.", "FORBIDDEN");
    throw new AppError("Vas muy rápido. Espera un minuto antes de seguir consultando.");
  }
  const quota = partner.dailyQuota ?? (await getPartnerSettings()).dailyQuota;
  const used = await hit(quotaKey(partner.id), DAY_MS);
  if (used > quota) {
    const over = used - quota;
    await logPartnerActivity({ partnerId: partner.id, type: "QUOTA_EXCEEDED", meta: { quota, attempts: over }, ip });
    if (over >= QUOTA_OVERRUN_BLOCK_AFTER) {
      await autoBlock(partner.id, "Cuota diaria excedida de forma reiterada", { quota, attempts: over });
      throw new AppError("Tu acceso fue bloqueado por actividad inusual. Contacta a MAC Compresores.", "FORBIDDEN");
    }
    throw new AppError("Llegaste al límite de consultas de hoy. Vuelve mañana.");
  }
  return { remaining: Math.max(0, quota - used) };
}

/** Consultas restantes hoy sin consumir cuota (para pintar el contador al cargar la página). */
export async function getQuotaRemaining(partner: LimitedPartner): Promise<number> {
  const quota = partner.dailyQuota ?? (await getPartnerSettings()).dailyQuota;
  const row = await db.rateLimit.findUnique({ where: { key: quotaKey(partner.id) } });
  const used = row && row.resetAt > new Date() ? row.count : 0;
  return Math.max(0, quota - used);
}
