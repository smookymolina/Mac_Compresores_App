import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { NextRequest } from "next/server";
import { signPriceToken, verifyPriceToken } from "@/modules/partners/token";
import { buildPriceSvg, renderPriceImage, watermarkBits } from "@/lib/price-image";
import { middleware } from "@/middleware";

beforeAll(() => {
  process.env.PARTNER_TOKEN_SECRET = "test-secret-test-secret-test-secret";
});

const claims = { productId: "11111111-1111-4111-8111-111111111111", partnerId: "22222222-2222-4222-8222-222222222222", sessionId: "s".repeat(64) };

describe("token de precio", () => {
  it("válido: devuelve los datos", () => {
    expect(verifyPriceToken(signPriceToken(claims))).toEqual(claims);
  });
  it("expirado: null", () => {
    expect(verifyPriceToken(signPriceToken({ ...claims, exp: Math.floor(Date.now() / 1000) - 1 }))).toBeNull();
  });
  it("vence a ~60 s", () => {
    const body = JSON.parse(Buffer.from(signPriceToken(claims).split(".")[0]!, "base64url").toString());
    const ttl = body.e - Math.floor(Date.now() / 1000);
    expect(ttl).toBeGreaterThan(55);
    expect(ttl).toBeLessThanOrEqual(60);
  });
  it("manipulado (payload, firma, formato): null", () => {
    const [b, s] = signPriceToken(claims).split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ p: "otro", u: claims.partnerId, s: claims.sessionId, e: 9999999999 })).toString("base64url");
    expect(verifyPriceToken(`${forged}.${s}`)).toBeNull();
    expect(verifyPriceToken(`${b}.${s.slice(0, -2)}AA`)).toBeNull();
    expect(verifyPriceToken(b)).toBeNull();
    expect(verifyPriceToken("")).toBeNull();
    expect(verifyPriceToken("a.b.c")).toBeNull();
  });
  it("otra sesión: el token lleva su sessionId y no se puede cambiar", () => {
    const t = verifyPriceToken(signPriceToken(claims))!;
    expect(t.sessionId).toBe(claims.sessionId);
    expect(t.sessionId).not.toBe("otra");
    const other = verifyPriceToken(signPriceToken({ ...claims, sessionId: "otra" }))!;
    expect(other.sessionId).toBe("otra"); // el handler compara contra la sesión actual y responde 404
  });
  it("firmado con otro secreto: null", () => {
    const t = signPriceToken(claims);
    process.env.PARTNER_TOKEN_SECRET = "otro-secreto-otro-secreto-otro-secreto";
    expect(verifyPriceToken(t)).toBeNull();
    process.env.PARTNER_TOKEN_SECRET = "test-secret-test-secret-test-secret";
  });
});

describe("renderPriceImage", () => {
  const input = { amount: "98765.43", currency: "MXN", watermark: "Socio Prueba|abcd1234|2026-10-13T10:00|10.1.2.3" };

  it("produce un PNG válido de 288x64 sin metadatos", async () => {
    const png = await renderPriceImage(input);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const meta = await sharp(png).metadata();
    expect(meta).toMatchObject({ format: "png", width: 288, height: 64 });
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(meta.iptc).toBeUndefined();
    const ascii = png.toString("latin1");
    for (const chunk of ["tEXt", "iTXt", "zTXt", "eXIf", "iCCP"]) expect(ascii).not.toContain(chunk);
    expect(png.length).toBeGreaterThan(1000);
    expect(png.length).toBeLessThan(40_000);
  });

  it("el monto y la marca no existen como texto (SVG con <path>, buffer y metadata)", async () => {
    const svg = buildPriceSvg(input);
    expect(svg).not.toMatch(/<text|<tspan|font-family/);
    expect(svg).not.toContain("98765");
    expect(svg).not.toContain("Socio Prueba");
    const png = await renderPriceImage(input);
    const hay = png.toString("latin1") + JSON.stringify(await sharp(png).metadata());
    for (const needle of ["98765", "98,765", "9876543", "765.43", "Socio", "abcd1234", "10.1.2.3"]) expect(hay).not.toContain(needle);
  });

  it("la marca es una etiqueta de 48 bits determinista por socio", () => {
    expect(watermarkBits("a")).toHaveLength(48);
    expect(watermarkBits("a")).toEqual(watermarkBits("a"));
    expect(watermarkBits("a")).not.toEqual(watermarkBits("b"));
  });

  it("p95 < 50 ms en 50 iteraciones", async () => {
    await renderPriceImage(input); // calentamiento
    const t: number[] = [];
    for (let i = 0; i < 50; i++) {
      const s = performance.now();
      await renderPriceImage({ ...input, amount: String(1000 + i * 1.5), watermark: `w${i}` });
      t.push(performance.now() - s);
    }
    t.sort((a, b) => a - b);
    expect(t[Math.floor(t.length * 0.95) - 1]!).toBeLessThan(50);
  });
});

describe("middleware por ruta", () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(`https://maccompresores.app${path}`, { headers: cookie ? { cookie } : {} });
  const loc = (r: Response) => r.headers.get("location");

  it("/socios/* sin cookie del socio redirige a /socios/login con cabeceras duras", () => {
    for (const p of ["/socios", "/socios/catalogo-completo", "/socios/algo"]) {
      const r = middleware(req(p));
      expect(r.status).toBe(307);
      expect(new URL(loc(r)!).pathname).toBe("/socios/login");
      expect(r.headers.get("cache-control")).toContain("no-store");
      expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
      expect(r.headers.get("referrer-policy")).toBe("no-referrer");
      expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    }
  });
  it("/socios/login y /socios/2fa pasan sin cookie, con CSP", () => {
    for (const p of ["/socios/login", "/socios/2fa"]) {
      const r = middleware(req(p));
      expect(r.status).toBe(200);
      const csp = r.headers.get("content-security-policy")!;
      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("img-src 'self' data: blob:");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'self'");
    }
  });
  it("con cookie del socio pasa; la cookie interna no sirve para /socios", () => {
    expect(middleware(req("/socios", "__Secure-mac_partner=x")).status).toBe(200);
    expect(middleware(req("/socios/p/abc", "mac_partner=x")).status).toBe(200);
    expect(middleware(req("/socios", "mac_session=x")).status).toBe(307);
  });
  it("PNG sin sesión responde 404 (no redirige)", () => {
    expect(middleware(req("/socios/p/abc")).status).toBe(404);
  });
  it("el resto de la app conserva mac_session y no lleva CSP del portal", () => {
    const r = middleware(req("/dashboard"));
    expect(r.status).toBe(307);
    expect(new URL(loc(r)!).pathname).toBe("/login");
    const ok = middleware(req("/dashboard", "mac_session=x"));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-security-policy")).toBeNull();
    expect(middleware(req("/login")).status).toBe(200);
    expect(middleware(req("/robots.txt")).status).toBe(200);
    // /socios-admin no es del portal: usa mac_session
    expect(new URL(loc(middleware(req("/socios-admin")))!).pathname).toBe("/login");
    expect(middleware(req("/socios-admin", "mac_session=x")).status).toBe(200);
  });
});
