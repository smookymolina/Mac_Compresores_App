import "server-only";
import type { Prisma, PartnerActivityType } from "@prisma/client";
import { db } from "@/lib/db";

/** Bitácora de actividad del socio. Nunca debe romper el flujo del llamador: los fallos se tragan. */
export async function logPartnerActivity(input: {
  partnerId: string;
  type: PartnerActivityType;
  meta?: Prisma.InputJsonValue;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<void> {
  try {
    await db.partnerActivity.create({
      data: {
        partnerId: input.partnerId,
        type: input.type,
        meta: input.meta,
        ip: input.ip ? input.ip.slice(0, 64) : null,
        userAgent: input.userAgent ? input.userAgent.slice(0, 300) : null,
      },
    });
  } catch (e) {
    console.error("[partners] no se pudo registrar la actividad", input.type, e instanceof Error ? e.message : e);
  }
}
