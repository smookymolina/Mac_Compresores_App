import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { compareVersions, publishAndroidRelease } from "@/modules/sync/releases";
import { signDownloadToken, verifyDownloadToken } from "@/modules/sync/download-token";
import { androidDownloadResponse, requestAppDownload } from "@/modules/sync/app-download";
import { GET as versionGET } from "@/app/api/app/version/route";

const tag = `apprel-${Date.now()}`;
const ip = `10.9.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
let dir = "";
let prevSetting: unknown;

const apk = (n = 64) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(n, 7)]);

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mac-releases-"));
  process.env.MOBILE_RELEASES_DIR = dir;
  prevSetting = (await db.setting.findUnique({ where: { key: "mobile.app" } }))?.value;
});

afterAll(async () => {
  if (prevSetting === undefined) await db.setting.deleteMany({ where: { key: "mobile.app" } });
  else await db.setting.update({ where: { key: "mobile.app" }, data: { value: prevSetting as object } });
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await rm(dir, { recursive: true, force: true });
  await db.$disconnect();
});

async function mkUser(code: "ADMIN" | "VENTAS", suffix: string, mobileAccess = true): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const email = `${tag}-${suffix}@t`;
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id, mobileAccess } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

const dl = (query = "", session: string | null = null) =>
  androidDownloadResponse(new Request(`http://x/api/app/download/android${query}`, { headers: { "x-real-ip": ip } }), async () => session);

describe("publicación del APK", () => {
  it("compara versiones semánticas", () => {
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("1.4.0", "1.4.0")).toBe(0);
    expect(compareVersions("1.4.0-beta", "1.4.0")).toBe(-1);
    expect(compareVersions("x", "0.0.1")).toBe(-1);
  });

  it("valida archivo, semver y mínima; conserva solo 3 versiones", async () => {
    const admin = await mkUser("ADMIN", "admin");
    const seller = await mkUser("VENTAS", "seller");
    const base = { minimum: "1.0.0", notes: "n" };
    await expect(publishAndroidRelease(seller, { ...base, version: "1.0.0", file: apk() })).rejects.toThrow(/permiso/);
    await expect(publishAndroidRelease(admin, { ...base, version: "1.0.0", file: Buffer.from("no es zip") })).rejects.toThrow(/APK válido/);
    await expect(publishAndroidRelease(admin, { ...base, version: "1.0", file: apk() })).rejects.toThrow();
    await expect(publishAndroidRelease(admin, { ...base, version: "../x", file: apk() })).rejects.toThrow();
    await expect(publishAndroidRelease(admin, { version: "1.0.0", minimum: "1.1.0", file: apk() })).rejects.toThrow();

    for (const v of ["1.0.0", "1.1.0", "1.2.0", "1.10.0"]) await publishAndroidRelease(admin, { ...base, version: v, file: apk() });
    expect((await readdir(dir)).sort()).toEqual(["mac-campo-1.1.0.apk", "mac-campo-1.10.0.apk", "mac-campo-1.2.0.apk"]);
    const last = await publishAndroidRelease(admin, { version: "1.11.0", minimum: "1.10.0", notes: "nueva", iosUrl: "https://example.test/ios", file: apk(100) });
    expect(last).toMatchObject({ latest: "1.11.0", minimum: "1.10.0", androidUrl: "/app", size: 104, iosUrl: "https://example.test/ios" });
    expect(last.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readdir(dir)).not.toContain("mac-campo-1.1.0.apk");
    expect(await db.auditLog.count({ where: { action: "app.release", userId: admin.id } })).toBe(5);
  });

  it("GET /api/app/version devuelve el contrato completo", async () => {
    const body = await (await versionGET(new Request("http://x/api/app/version"))).json();
    expect(Object.keys(body).sort()).toEqual(["androidUrl", "iosUrl", "latest", "minimum", "notes", "publishedAt", "sha256", "size"]);
    expect(body).toMatchObject({ latest: "1.11.0", androidUrl: "/app" });
  });
});

describe("descarga del APK", () => {
  it("token firmado: válido, vencido, alterado y dispositivo revocado", async () => {
    const seller = await mkUser("VENTAS", "dl");
    const device = await db.device.create({ data: { userId: seller.id, name: "t", platform: "ANDROID", appVersion: "1.0.0", tokenHash: `${tag}-d` } });
    const { url, expiresAt } = await requestAppDownload(device);
    expect(url).toMatch(/^\/api\/app\/download\/android\?t=/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);

    const ok = await dl(url.slice(url.indexOf("?")));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    expect(ok.headers.get("content-disposition")).toBe('attachment; filename="mac-campo-1.11.0.apk"');
    expect(ok.headers.get("content-length")).toBe("104");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await ok.arrayBuffer()).byteLength).toBe(104);
    expect(await db.auditLog.count({ where: { action: "app.download", userId: seller.id } })).toBe(1);

    const old = signDownloadToken({ deviceId: device.id, version: "1.11.0" }, Date.now() - 11 * 60_000).token;
    expect(verifyDownloadToken(old)).toBeNull();
    expect((await dl(`?t=${old}`)).status).toBe(401);
    const t = new URL(url, "http://x").searchParams.get("t")!;
    const tampered = `${Buffer.from(JSON.stringify({ deviceId: device.id, version: "1.11.0", exp: Date.now() + 9e9 })).toString("base64url")}.${t.split(".")[1]}`;
    expect((await dl(`?t=${tampered}`)).status).toBe(401);

    await db.user.update({ where: { id: seller.id }, data: { mobileAccess: false } });
    expect((await dl(`?t=${encodeURIComponent(t)}`)).status).toBe(403);
    await db.user.update({ where: { id: seller.id }, data: { mobileAccess: true } });
    await db.device.update({ where: { id: device.id }, data: { revokedAt: new Date() } });
    expect((await dl(`?t=${encodeURIComponent(t)}`)).status).toBe(401);
  });

  it("sesión web: requiere acceso móvil", async () => {
    const withAccess = await mkUser("VENTAS", "s1");
    const without = await mkUser("VENTAS", "s2", false);
    expect((await dl()).status).toBe(401);
    expect((await dl("", without.id)).status).toBe(403);
    const r = await dl("", withAccess.id);
    expect(r.status).toBe(200);
    await r.arrayBuffer();
  });
});
