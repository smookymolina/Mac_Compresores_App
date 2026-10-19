import "server-only";
import { db } from "@/lib/db";

/** Días que se conserva la bitácora `SyncChange`. */
export const SYNC_RETENTION_DAYS = 30;
/** Setting con el seq más alto borrado: cursores por debajo deben volver a descargar. */
export const PRUNED_SEQ_KEY = "sync.prunedSeq";
const BATCH = 10_000;

/** El cursor del teléfono es anterior a lo que conserva la bitácora (HTTP 410 RESYNC). */
export class SyncResyncError extends Error {
  constructor(message = "Vuelve a descargar los datos.") {
    super(message);
    this.name = "SyncResyncError";
  }
}

/** Piso de la bitácora (0 si nunca se ha depurado). */
export async function getPrunedSeq(): Promise<bigint> {
  const s = await db.setting.findUnique({ where: { key: PRUNED_SEQ_KEY } });
  const v = s?.value;
  return (typeof v === "string" || typeof v === "number") && /^\d{1,19}$/.test(String(v)) ? BigInt(v) : BigInt(0);
}

/**
 * Borra cambios de más de 30 días que ya bajaron todos los dispositivos activos
 * (no revocados y vistos en los últimos 30 días). Por lotes, cada uno en su transacción
 * junto con el piso `sync.prunedSeq`. Devuelve cuántas filas se borraron.
 */
export async function pruneSyncChanges(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - SYNC_RETENTION_DAYS * 864e5);
  const active = await db.device.aggregate({
    _min: { lastPullSeq: true },
    where: { revokedAt: null, OR: [{ lastSeenAt: { gte: cutoff } }, { lastSeenAt: null, createdAt: { gte: cutoff } }] },
  });
  const maxSeq = active._min.lastPullSeq ?? BigInt("9223372036854775807");
  let total = 0;
  for (;;) {
    const n = await db.$transaction(async (tx) => {
      const [r] = await tx.$queryRaw<{ n: number; m: bigint | null }[]>`
        WITH d AS (
          DELETE FROM "SyncChange" WHERE seq IN (
            SELECT seq FROM "SyncChange" WHERE "changedAt" < ${cutoff} AND seq <= ${maxSeq} ORDER BY seq LIMIT ${BATCH}
          ) RETURNING seq
        ) SELECT count(*)::int AS n, max(seq) AS m FROM d`;
      if (!r || r.n === 0 || r.m === null) return 0;
      const prev = await tx.setting.findUnique({ where: { key: PRUNED_SEQ_KEY } });
      const prevSeq = typeof prev?.value === "string" && /^\d+$/.test(prev.value) ? BigInt(prev.value) : BigInt(0);
      const value = (r.m > prevSeq ? r.m : prevSeq).toString();
      await tx.setting.upsert({ where: { key: PRUNED_SEQ_KEY }, create: { key: PRUNED_SEQ_KEY, value }, update: { value } });
      return r.n;
    });
    total += n;
    if (n < BATCH) return total;
  }
}
