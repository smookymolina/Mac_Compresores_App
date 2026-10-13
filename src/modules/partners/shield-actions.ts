"use server";

import { headers } from "next/headers";
import type { Prisma } from "@prisma/client";
import { hit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { logPartnerActivity } from "./activity";
import { autoBlock } from "./guard";
import { getCurrentPartner } from "./session";

// Lista blanca: cualquier otro tipo se ignora (el cliente nunca elige libremente qué se escribe en la bitácora).
const ALLOWED = new Set(["HIDDEN", "PRINT_ATTEMPT", "COPY_ATTEMPT", "CAPTURE_KEY", "DEVTOOLS", "WEBDRIVER"]);

/** Meta pequeña y plana: solo escalares cortos, máximo 8 claves. */
function cleanMeta(meta: unknown): Prisma.InputJsonObject | undefined {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>).slice(0, 8)) {
    if (typeof v === "string") out[k.slice(0, 30)] = v.slice(0, 80);
    else if (typeof v === "number" && Number.isFinite(v)) out[k.slice(0, 30)] = v;
    else if (typeof v === "boolean") out[k.slice(0, 30)] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Evento sospechoso reportado por el navegador del socio. Requiere sesión; solo WEBDRIVER bloquea,
 * el resto únicamente se registra (la pestaña oculta, devtools, impresión y copia no son prueba suficiente).
 */
export async function reportSuspiciousAction(type: string, meta?: unknown): Promise<{ ok: boolean }> {
  if (typeof type !== "string" || !ALLOWED.has(type)) return { ok: false };
  const current = await getCurrentPartner();
  if (!current || current.partner.status !== "ACTIVE") return { ok: false };
  const partnerId = current.partner.id;

  // Límite por socio: el cliente ya hace throttle, esto frena a quien llame la acción directamente.
  if ((await hit(`pshield:${partnerId}`, 60_000)) > 20) return { ok: false };

  const h = await headers();
  const ip = clientIp(h);
  await logPartnerActivity({
    partnerId,
    type: type as "HIDDEN" | "PRINT_ATTEMPT" | "COPY_ATTEMPT" | "CAPTURE_KEY" | "DEVTOOLS" | "WEBDRIVER",
    meta: cleanMeta(meta),
    ip,
    userAgent: h.get("user-agent"),
  });
  if (type === "WEBDRIVER") await autoBlock(partnerId, "WEBDRIVER", cleanMeta(meta));
  return { ok: true };
}
