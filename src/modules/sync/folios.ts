import "server-only";
import type { Device } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

export const foliosSchema = z.object({ count: z.coerce.number().int().min(1).max(25) });

/** Folios reservados y aún sin usar del dispositivo. */
export async function unusedFolios(deviceId: string): Promise<number[]> {
  const rows = await db.reservedFolio.findMany({ where: { deviceId, usedAt: null }, orderBy: { folio: "asc" }, select: { folio: true } });
  return rows.map((r) => r.folio);
}

/**
 * Reserva `count` folios de la misma secuencia de `Quote.folio` para usarlos sin conexión.
 * Devuelve todos los folios libres del dispositivo (los nuevos y los que ya tenía).
 */
export async function reserveFolios(device: Device, raw: unknown) {
  const { count } = foliosSchema.parse(raw);
  await db.$transaction(async (tx) => {
    const seq = await tx.$queryRaw<{ folio: bigint }[]>`
      SELECT nextval(pg_get_serial_sequence('"Quote"', 'folio')) AS folio FROM generate_series(1, ${count}::int)`;
    const folios = seq.map((r) => Number(r.folio));
    await tx.reservedFolio.createMany({ data: folios.map((folio) => ({ folio, deviceId: device.id })) });
    await audit({ userId: device.userId, action: "device.folios", entity: "Device", entityId: device.id, data: { folios } }, tx);
  });
  return { folios: await unusedFolios(device.id) };
}
