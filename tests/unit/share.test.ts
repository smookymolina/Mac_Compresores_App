import { describe, expect, it } from "vitest";
import { signToken, verifyToken, type SharePayload } from "@/lib/share";
import { formatPhone, normalizePhone, whatsappUrl } from "@/modules/quotes/phone";

const SECRET = "s".repeat(32);
const quote = (exp: number): SharePayload => ({ t: "quote", id: "8f0c2a43-6c1e-4d7c-9a51-1f9c0f1d2e3a", u: "u1", exp });

describe("enlaces firmados", () => {
  it("valida firma y devuelve el payload", () => {
    const p = quote(Date.now() + 60_000);
    expect(verifyToken(SECRET, signToken(SECRET, p))).toEqual(p);
  });
  it("rechaza vencidos, alterados o firmados con otra clave", () => {
    expect(verifyToken(SECRET, signToken(SECRET, quote(Date.now() - 1)))).toBeNull();
    const [body, sig] = signToken(SECRET, quote(Date.now() + 60_000)).split(".");
    const forged = Buffer.from(JSON.stringify({ ...quote(Date.now() + 60_000), u: "admin" })).toString("base64url");
    expect(verifyToken(SECRET, `${forged}.${sig}`)).toBeNull();
    expect(verifyToken(SECRET, `${body}.${sig}x`)).toBeNull();
    expect(verifyToken("otro-secreto-de-32-caracteres!!!", `${body}.${sig}`)).toBeNull();
    expect(verifyToken(SECRET, "basura")).toBeNull();
  });
});

describe("teléfonos para WhatsApp", () => {
  it("normaliza a +52 por omisión", () => {
    expect(normalizePhone("55 1234 5678")).toBe("525512345678");
    expect(normalizePhone("(55) 1234-5678")).toBe("525512345678");
    expect(normalizePhone("044 55 1234 5678")).toBe("525512345678");
    expect(normalizePhone("+52 1 55 1234 5678")).toBe("525512345678");
    expect(normalizePhone("+52 55 1234 5678")).toBe("525512345678");
  });
  it("respeta otros países y rechaza inválidos", () => {
    expect(normalizePhone("+1 (415) 555-0100")).toBe("14155550100");
    expect(normalizePhone("0034 612 345 678")).toBe("34612345678");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+52 55 1234")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
  it("formatea y arma el enlace", () => {
    expect(formatPhone("525512345678")).toBe("+52 55 1234 5678");
    expect(whatsappUrl("525512345678", "Hola & adiós")).toBe("https://wa.me/525512345678?text=Hola%20%26%20adi%C3%B3s");
  });
});
