import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { D } from "@/lib/money";
import { effectiveDiscount, getPartnerPrice } from "@/modules/partners/pricing";
import { detectSweep } from "@/modules/partners/sweep";
import { decryptSecret, encryptSecret } from "@/modules/partners/crypto";
import { signPreToken, verifyPreToken } from "@/modules/partners/session";
import { cleanSearchTerm } from "@/modules/partners/search";

beforeAll(() => {
  process.env.PARTNER_TOTP_KEY = randomBytes(32).toString("hex");
  process.env.PARTNER_TOKEN_SECRET = "test-secret-partners-0123456789";
});

describe("precio del socio", () => {
  it("aplica el descuento y redondea half-up a 2 decimales", () => {
    expect(getPartnerPrice("1000", 15).toString()).toBe("850");
    expect(getPartnerPrice("1000", 10).toFixed(2)).toBe("900.00");
    expect(getPartnerPrice("0.10", 15).toFixed(2)).toBe("0.09"); // 0.085 → 0.09 (half-up)
    expect(getPartnerPrice("100.10", 5).toFixed(2)).toBe("95.10"); // 95.095 → 95.10
    expect(getPartnerPrice("7391.37", "15.00").toFixed(2)).toBe("6282.66");
  });
  it("0% devuelve el precio de lista; sirve igual para MXN y USD (el monto no se convierte)", () => {
    expect(getPartnerPrice("123.45", 0).toFixed(2)).toBe("123.45");
    expect(getPartnerPrice(new D("48.20"), 15).toFixed(2)).toBe("40.97"); // USD 48.20 × 0.85 = 40.97
  });
  it("effectiveDiscount: el del socio manda (incluso 0) y si no, el global", () => {
    const g = { discountPct: new D(15) };
    expect(effectiveDiscount({ discountPct: null }, g).toString()).toBe("15");
    expect(effectiveDiscount({ discountPct: new D("20.5") }, g).toString()).toBe("20.5");
    expect(effectiveDiscount({ discountPct: new D(0) }, g).toString()).toBe("0");
  });
});

describe("detectSweep", () => {
  it("detecta prefijos consecutivos", () => {
    expect(detectSweep(["aaa", "aab", "aac", "aad"])).toMatchObject({ suspect: true, reason: "incremental" });
    expect(detectSweep(["100", "101", "102", "103", "104"]).suspect).toBe(true);
  });
  it("detecta barrido alfabético de términos cortos", () => {
    expect(detectSweep(["abc", "bcd", "cde", "def", "efg", "fgh"])).toMatchObject({ suspect: true, reason: "alphabetical" });
  });
  it("no marca el uso normal ni escribir progresivamente", () => {
    expect(detectSweep(["com", "comp", "compr", "compre", "compres"]).suspect).toBe(false);
    expect(detectSweep(["filtro", "válvula", "aceite", "kit", "banda", "manguera"]).suspect).toBe(false);
    expect(detectSweep(["aaa", "aab", "aac"]).suspect).toBe(false);
    expect(detectSweep([]).suspect).toBe(false);
  });
});

describe("crypto del secreto TOTP", () => {
  it("round-trip AES-256-GCM en formato iv:tag:ct (base64)", () => {
    const enc = encryptSecret("JBSWY3DPEHPK3PXP");
    expect(enc.split(":")).toHaveLength(3);
    expect(enc).not.toContain("JBSWY3DPEHPK3PXP");
    expect(decryptSecret(enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(encryptSecret("JBSWY3DPEHPK3PXP")).not.toBe(enc); // IV aleatorio
  });
  it("rechaza datos alterados y acepta llave en base64", () => {
    const enc = encryptSecret("abc");
    const [iv, tag, ct] = enc.split(":");
    const bad = Buffer.from(ct!, "base64");
    bad[0] = bad[0]! ^ 1;
    expect(() => decryptSecret([iv, tag, bad.toString("base64")].join(":"))).toThrow();
    expect(() => decryptSecret("x:y")).toThrow();
    const hex = process.env.PARTNER_TOTP_KEY!;
    process.env.PARTNER_TOTP_KEY = Buffer.from(hex, "hex").toString("base64");
    expect(decryptSecret(encryptSecret("abc"))).toBe("abc");
    process.env.PARTNER_TOTP_KEY = hex;
  });
});

describe("cookie previa al 2FA y término de búsqueda", () => {
  it("firma, vence y detecta alteraciones", () => {
    const t = signPreToken("p-1", 1_000);
    expect(verifyPreToken(t, 2_000)).toBe("p-1");
    expect(verifyPreToken(t, 1_000 + 11 * 60_000)).toBeNull();
    expect(verifyPreToken(t.slice(0, -2) + "xx", 2_000)).toBeNull();
  });
  it("cleanSearchTerm quita comodines LIKE y acentos", () => {
    expect(cleanSearchTerm("  VÁLvula ")).toBe("valvula");
    expect(cleanSearchTerm("%%_")).toBe("");
  });
});
