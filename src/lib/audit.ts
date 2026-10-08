import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";

export async function audit(
  entry: { userId: string | null; action: string; entity: string; entityId?: string; data?: Prisma.InputJsonValue },
  tx: Tx = db,
) {
  await tx.auditLog.create({ data: entry });
}
