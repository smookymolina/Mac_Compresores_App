import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { hashToken } from "@/lib/auth/session";
import { hashPassword } from "@/modules/users/service";
import { loadCurrentUser, newDeviceToken } from "@/modules/sync/device";
import { pull } from "@/modules/sync/pull";
import { getPrunedSeq, pruneSyncChanges, PRUNED_SEQ_KEY, SyncResyncError } from "@/modules/sync/prune";
import { GET as pullRoute } from "@/app/api/sync/pull/route";

const tag = `prune-${Date.now()}`;
const DAY = 864e5;
// "Ahora" del trabajo: 31 días en el futuro, así los dispositivos reales de la BD de pruebas no cuentan como activos.
const future = new Date(Date.now() + 31 * DAY);
const oldAt = new Date(Date.now() - 10 * DAY); // > 30 días antes de `future`
const recentAt = new Date(future.getTime() - DAY);

let userId = "", activeId = "", token = "";
const old: bigint[] = [], recent: bigint[] = [];

const exists = async (seqs: bigint[]) => (await db.syncChange.findMany({ where: { seq: { in: seqs } }, select: { seq: true } })).map((r) => r.seq);
const mkDevice = (data: { lastPullSeq: bigint; lastSeenAt: Date; revokedAt?: Date; tokenHash?: string }) =>
  db.device.create({ data: { userId, name: tag, platform: "ANDROID", appVersion: "1.4.0", tokenHash: data.tokenHash ?? hashToken(newDeviceToken()), ...data } });

beforeAll(async () => {
  const role = await db.role.upsert({ where: { code: "VENTAS" }, create: { code: "VENTAS", name: "VENTAS" }, update: {} });
  for (const p of ROLE_PERMISSIONS.VENTAS) {
    const perm = await db.permission.upsert({ where: { code: p }, create: { code: p }, update: {} });
    await db.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: perm.id } }, create: { roleId: role.id, permissionId: perm.id }, update: {} });
  }
  userId = (await db.user.create({ data: { email: `${tag}@t.mx`, name: "Prune", passwordHash: await hashPassword("Secreta-123"), roleId: role.id, mobileAccess: true } })).id;
  for (let i = 0; i < 4; i++) old.push((await db.syncChange.create({ data: { entity: "Warehouse", entityId: `${tag}-o${i}`, changedAt: oldAt } })).seq);
  for (let i = 0; i < 2; i++) recent.push((await db.syncChange.create({ data: { entity: "Warehouse", entityId: `${tag}-r${i}`, changedAt: recentAt } })).seq);
  token = newDeviceToken();
  activeId = (await mkDevice({ lastPullSeq: old[1]!, lastSeenAt: recentAt, tokenHash: hashToken(token) })).id;
  // No deben frenar la depuración: revocado y sin conexión hace más de 30 días.
  await mkDevice({ lastPullSeq: BigInt(0), lastSeenAt: recentAt, revokedAt: recentAt });
  await mkDevice({ lastPullSeq: BigInt(0), lastSeenAt: oldAt });
});

afterAll(async () => {
  await db.setting.deleteMany({ where: { key: PRUNED_SEQ_KEY } });
  await db.syncChange.deleteMany({ where: { entityId: { startsWith: tag } } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

describe("sync: depuración de la bitácora", () => {
  it("borra lo viejo solo hasta el lastPullSeq de los dispositivos activos", async () => {
    expect(await pruneSyncChanges(future)).toBeGreaterThanOrEqual(2);
    expect(await exists(old)).toEqual(old.slice(2));
    expect(await exists(recent)).toEqual(recent);
    expect(await getPrunedSeq()).toBe(old[1]);
  });

  it("cursor por debajo del piso → RESYNC (servicio y ruta HTTP 410)", async () => {
    const device = await db.device.findUniqueOrThrow({ where: { id: activeId } });
    const user = (await loadCurrentUser(userId))!;
    await expect(pull(user, device, old[1]! - BigInt(1))).rejects.toBeInstanceOf(SyncResyncError);
    await expect(pull(user, device, old[1]!)).resolves.toMatchObject({ hasMore: expect.any(Boolean) });

    const r = await pullRoute(new Request(`http://localhost/api/sync/pull?cursor=0`, { headers: { "x-sync-protocol": "1", authorization: `Bearer ${token}` } }));
    expect(r.status).toBe(410);
    expect(await r.json()).toEqual({ code: "RESYNC", error: "Vuelve a descargar los datos." });
  });

  it("al avanzar el dispositivo se borra el resto de lo viejo; lo reciente se queda", async () => {
    await db.device.update({ where: { id: activeId }, data: { lastPullSeq: recent[1]!, lastSeenAt: recentAt } });
    await pruneSyncChanges(future);
    expect(await exists(old)).toEqual([]);
    expect(await exists(recent)).toEqual(recent);
    expect(await getPrunedSeq()).toBe(old[3]);
  });
});
