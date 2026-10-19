import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import type { CurrentUser } from "@/lib/auth/session";
import { publishAndroidRelease, publishIosRelease } from "@/modules/sync/releases";
import { signDownloadToken } from "@/modules/sync/download-token";
import {
  androidDownloadResponse, iosIpaResponse, iosManifestPlist, iosManifestResponse, iosWebInstallUrl, requestAppDownload,
} from "@/modules/sync/app-download";
import { POST as appDownloadPOST } from "@/app/api/sync/app-download/route";
import { SYNC_PROTOCOL } from "@/modules/sync/device";
import { hashToken } from "@/lib/auth/session";

const tag = `appios-${Date.now()}`;
const ip = `10.8.${Date.now() % 250}.${Math.floor(Math.random() * 250)}`;
const BASE = "https://mac.test";
let dir = "";
let prevSetting: unknown;
let prevAppUrl: string | undefined;

const zip = (n = 64) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(n, 9)]);
const req = (p: string) => new Request(`http://x${p}`, { headers: { "x-real-ip": ip } });
const tokenOf = (u: string) => new URL(u).searchParams.get("t")!;
/** Token del manifiesto a partir del enlace itms-services. */
const manifestUrl = (itms: string) => new URL(itms).searchParams.get("url")!;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mac-releases-ios-"));
  process.env.MOBILE_RELEASES_DIR = dir;
  prevAppUrl = process.env.APP_URL;
  process.env.APP_URL = `${BASE}/`;
  prevSetting = (await db.setting.findUnique({ where: { key: "mobile.app" } }))?.value;
  await db.setting.deleteMany({ where: { key: "mobile.app" } });
});

afterAll(async () => {
  if (prevSetting === undefined) await db.setting.deleteMany({ where: { key: "mobile.app" } });
  else await db.setting.upsert({ where: { key: "mobile.app" }, create: { key: "mobile.app", value: prevSetting as object }, update: { value: prevSetting as object } });
  process.env.APP_URL = prevAppUrl;
  await db.user.deleteMany({ where: { email: { startsWith: tag } } });
  await rm(dir, { recursive: true, force: true });
  await db.$disconnect();
});

async function mkUser(code: "ADMIN" | "VENTAS", suffix: string): Promise<CurrentUser> {
  const role = await db.role.upsert({ where: { code }, create: { code, name: code }, update: {} });
  const email = `${tag}-${suffix}@t`;
  const u = await db.user.create({ data: { email, name: email, passwordHash: "x", roleId: role.id, mobileAccess: true } });
  return { id: u.id, name: u.name, email, role: code, roleName: code, permissions: new Set(ROLE_PERMISSIONS[code]) };
}

describe("iOS Ad Hoc", () => {
  let admin: CurrentUser;
  let seller: CurrentUser;
  let deviceId = "";
  const bearer = `${tag}-bearer`;

  it("sin IPA: app-download ios 404 y android sigue igual (404 sin APK)", async () => {
    admin = await mkUser("ADMIN", "admin");
    seller = await mkUser("VENTAS", "seller");
    deviceId = (await db.device.create({ data: { userId: seller.id, name: "i", platform: "IOS", appVersion: "1.0.0", tokenHash: hashToken(bearer) } })).id;
    const post = (body?: object) => appDownloadPOST(new Request("http://x/api/sync/app-download", {
      method: "POST", headers: { authorization: `Bearer ${bearer}`, "x-sync-protocol": String(SYNC_PROTOCOL), "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }));
    expect((await post({ platform: "ios" })).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect((await post({ platform: "windows" })).status).toBe(400);
    expect(await iosWebInstallUrl(seller.id)).toBeNull();
  });

  it("publica IPA: valida, conserva 3, audita y fija iosUrl=/app", async () => {
    await expect(publishIosRelease(seller, { version: "1.0.0", file: zip() })).rejects.toThrow(/permiso/);
    await expect(publishIosRelease(admin, { version: "1.0.0", file: Buffer.from("nada") })).rejects.toThrow(/IPA válido/);
    await expect(publishIosRelease(admin, { version: "1.0.0", file: Buffer.alloc(0) })).rejects.toThrow(/IPA/);
    await expect(publishIosRelease(admin, { version: "../x", file: zip() })).rejects.toThrow();
    for (const v of ["1.0.0", "1.1.0", "1.2.0", "1.10.0"]) await publishIosRelease(admin, { version: v, file: zip() });
    expect((await readdir(dir)).sort()).toEqual(["mac-campo-1.1.0.ipa", "mac-campo-1.10.0.ipa", "mac-campo-1.2.0.ipa"]);
    expect(await db.auditLog.count({ where: { action: "app.release_ios", userId: admin.id } })).toBe(4);

    // Publicar Android conserva el IPA y su prune no toca los .ipa (ni al revés).
    const a = await publishAndroidRelease(admin, { version: "2.0.0", minimum: "1.0.0", iosUrl: "https://testflight.test/x", file: zip(10) });
    expect(a.iosUrl).toBe("/app");
    expect(a.ios).toMatchObject({ latest: "1.10.0", size: 68, bundleId: "mx.com.maccompresores.campo" });
    expect(a.ios?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readdir(dir)).toContain("mac-campo-1.1.0.ipa");
  });

  it("app-download ios devuelve itms-services con URL absoluta https al manifiesto", async () => {
    const { url, expiresAt } = await requestAppDownload({ id: deviceId }, "ios");
    expect(url).toMatch(/^itms-services:\/\/\?action=download-manifest&url=https%3A%2F%2Fmac\.test%2Fapi%2Fapp%2Fdownload%2Fios%2Fmanifest\.plist%3Ft%3D/);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(manifestUrl(url).startsWith(`${BASE}/api/app/download/ios/manifest.plist?t=`)).toBe(true);
    const android = await requestAppDownload({ id: deviceId });
    expect(android.url).toMatch(/^\/api\/app\/download\/android\?t=/);
  });

  it("manifiesto: mismo token, URLs absolutas y valores escapados; IPA se transmite", async () => {
    const mUrl = manifestUrl((await requestAppDownload({ id: deviceId }, "ios")).url);
    const t = tokenOf(mUrl);
    const m = await iosManifestResponse(req(new URL(mUrl).pathname + new URL(mUrl).search));
    expect(m.status).toBe(200);
    expect(m.headers.get("content-type")).toBe("application/xml");
    expect(m.headers.get("cache-control")).toBe("no-store");
    const xml = await m.text();
    const ipaUrl = `${BASE}/api/app/download/ios/app.ipa?t=${encodeURIComponent(t)}`;
    expect(xml).toContain(`<string>${ipaUrl}</string>`);
    expect(xml).toContain("<string>mx.com.maccompresores.campo</string>");
    expect(xml).toContain("<string>1.10.0</string>");
    expect(xml).toContain("<string>MAC Campo</string>");
    expect(iosManifestPlist({ ipaUrl: "https://a/b?x=1&y=<2>", bundleId: `"q'`, version: "1" }))
      .toContain("<string>https://a/b?x=1&amp;y=&lt;2&gt;</string>");
    expect(iosManifestPlist({ ipaUrl: "u", bundleId: `"q'`, version: "1" })).toContain("<string>&quot;q&apos;</string>");

    const ipa = await iosIpaResponse(req(`/api/app/download/ios/app.ipa?t=${encodeURIComponent(t)}`));
    expect(ipa.status).toBe(200);
    expect(ipa.headers.get("content-type")).toBe("application/octet-stream");
    expect((await ipa.arrayBuffer()).byteLength).toBe(68);
    const logs = await db.auditLog.findMany({ where: { action: "app.download", userId: seller.id } });
    expect(logs.map((l) => (l.data as { platform: string }).platform)).toEqual(["ios"]);
  });

  it("tokens no se cruzan entre plataformas; vencido o sin token se rechaza", async () => {
    const iosT = tokenOf(manifestUrl((await requestAppDownload({ id: deviceId }, "ios")).url));
    const andT = tokenOf(`http://x${(await requestAppDownload({ id: deviceId })).url}`);
    const enc = encodeURIComponent;
    const dlAndroid = (t: string) => androidDownloadResponse(req(`/api/app/download/android?t=${enc(t)}`), async () => seller.id);
    expect((await dlAndroid(iosT)).status).toBe(401);
    expect((await iosManifestResponse(req(`/api/app/download/ios/manifest.plist?t=${enc(andT)}`))).status).toBe(401);
    expect((await iosIpaResponse(req(`/api/app/download/ios/app.ipa?t=${enc(andT)}`))).status).toBe(401);
    const ok = await dlAndroid(andT);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/vnd.android.package-archive");
    await ok.arrayBuffer();

    const old = signDownloadToken({ deviceId, version: "1.10.0", platform: "ios" }, Date.now() - 11 * 60_000).token;
    expect((await iosManifestResponse(req(`/api/app/download/ios/manifest.plist?t=${enc(old)}`))).status).toBe(401);
    expect((await iosIpaResponse(req(`/api/app/download/ios/app.ipa?t=${enc(old)}`))).status).toBe(401);
    expect((await iosIpaResponse(req("/api/app/download/ios/app.ipa"))).status).toBe(401);
  });

  it("página /app: token de usuario (sin dispositivo) válido solo para iOS", async () => {
    const link = await iosWebInstallUrl(seller.id);
    expect(link).toMatch(/^itms-services:/);
    const mUrl = manifestUrl(link!);
    const m = await iosManifestResponse(req(new URL(mUrl).pathname + new URL(mUrl).search));
    expect(m.status).toBe(200);
    await m.text();
    expect((await androidDownloadResponse(req(`/api/app/download/android?t=${encodeURIComponent(tokenOf(mUrl))}`), async () => null)).status).toBe(401);
    await db.user.update({ where: { id: seller.id }, data: { mobileAccess: false } });
    expect((await iosManifestResponse(req(new URL(mUrl).pathname + new URL(mUrl).search))).status).toBe(403);
  });
});
