import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { listSyncIssues, resolveSyncIssue, revokeDevice, setMobileAccess } from "@/modules/sync/admin";

const tag = `syncadm-${Date.now()}`;

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await db.$disconnect();
});

async function mkUser(code: "ADMIN" | "VENTAS", suffix: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const email = `${tag}-${suffix}@t`;
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id, mobileAccess: true } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

const mkDevice = (userId: string, n: string) =>
  db.device.create({ data: { userId, name: n, platform: "ANDROID", appVersion: "1.0.0", tokenHash: `${tag}-${n}` } });

describe("administración de la app móvil", () => {
  it("quitar el acceso móvil revoca los dispositivos activos y audita", async () => {
    const admin = await mkUser("ADMIN", "admin");
    const seller = await mkUser("VENTAS", "seller");
    const [d1, d2] = [await mkDevice(seller.id, "a"), await mkDevice(seller.id, "b")];
    await revokeDevice(admin, d2.id);
    await expect(revokeDevice(admin, d2.id)).rejects.toThrow(/ya estaba revocado/);

    await expect(setMobileAccess(seller, seller.id, false)).rejects.toThrow(/permiso/);
    const r = await setMobileAccess(admin, seller.id, false);
    expect(r.revoked).toBe(1);
    expect((await db.user.findUniqueOrThrow({ where: { id: seller.id } })).mobileAccess).toBe(false);
    const dev = await db.device.findUniqueOrThrow({ where: { id: d1.id } });
    expect(dev.revokedAt).not.toBeNull();
    expect(dev.revokedById).toBe(admin.id);
    expect(await db.auditLog.count({ where: { action: "user.mobile_access", entityId: seller.id } })).toBe(1);
  });

  it("lista y resuelve incidencias una sola vez", async () => {
    const admin = await mkUser("ADMIN", "admin2");
    const d = await mkDevice(admin.id, "c");
    const cmd = await db.syncCommand.create({
      data: { id: crypto.randomUUID(), deviceId: d.id, userId: admin.id, type: "quote.create", payload: {}, status: "CONFLICT", error: "x", capturedAt: new Date() },
    });
    expect((await listSyncIssues()).find((i) => i.id === cmd.id)?.userName).toBe(admin.name);
    await resolveSyncIssue(admin, cmd.id);
    await expect(resolveSyncIssue(admin, cmd.id)).rejects.toThrow(/ya fue revisada/);
    expect((await listSyncIssues()).some((i) => i.id === cmd.id)).toBe(false);
  });
});
