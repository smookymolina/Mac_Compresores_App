import { describe, expect, it } from "vitest";
import { skuMatches, suggestFor, warrantyText, type ComplementOption } from "@/modules/complements/match";

const opt = (code: string, warrantyMonths: number, skuPatterns: string[]): ComplementOption => ({ code, name: code, activities: [], warrantyMonths, skuPatterns });

describe("complementos", () => {
  it("compara SKU con comodines sin distinguir mayúsculas", () => {
    expect(skuMatches("8000-*", "8000-5-15hp")).toBe(true);
    expect(skuMatches("RM*", "rm-30hp")).toBe(true);
    expect(skuMatches("SERV-*-PI*", "SERV-15-PI")).toBe(true);
    expect(skuMatches("K-*", "KS-SH-46-LT")).toBe(false);
    expect(skuMatches("MANG-1/2", "MANG-1/2")).toBe(true);
    expect(skuMatches("", "X")).toBe(false);
  });
  it("sugiere paquetes por SKU", () => {
    const opts = [opt("SERV-8000", 3, ["8000-*"]), opt("SERV-RENTA", 1, ["RM*"])];
    expect(suggestFor(opts, "RM50").map((o) => o.code)).toEqual(["SERV-RENTA"]);
    expect(suggestFor(opts, "6.4212.0")).toEqual([]);
  });
  it("redacta la garantía", () => {
    expect(warrantyText(1)).toBe("1 mes");
    expect(warrantyText(12)).toBe("12 meses");
  });
});

describe("complementos por descripción", () => {
  it("sugiere renta por descripción aunque el SKU no siga el patrón", () => {
    const opts = [{ code: "SERV-RENTA", name: "", activities: [], warrantyMonths: 1, skuPatterns: ["RM*", "Renta *"] }];
    expect(suggestFor(opts, "CIN-10RM", "Renta de compresor de 10 HP por 1 mes").length).toBe(1);
    expect(suggestFor(opts, "6.4212.0", "ELEMENT - AIR")).toEqual([]);
  });
});
