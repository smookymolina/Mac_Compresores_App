import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

export async function audit(
  entry: { userId: string | null; action: string; entity: string; entityId?: string; data?: Prisma.InputJsonValue },
  tx: Tx = db,
) {
  await tx.auditLog.create({ data: entry });
}

/** Contexto opcional de la app móvil para operaciones de servicio (dispositivo y hora real de captura). */
export interface SyncMeta {
  deviceId?: string;
  capturedAt?: Date;
}

/** Campos de auditoría de la app móvil (vacío en la web). */
export function deviceData(deviceId?: string, capturedAt?: Date): { deviceId?: string; capturedAt?: string } | undefined {
  if (!deviceId && !capturedAt) return undefined;
  return { ...(deviceId && { deviceId }), ...(capturedAt && { capturedAt: capturedAt.toISOString() }) };
}
