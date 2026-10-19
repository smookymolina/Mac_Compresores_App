import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { computeLine, listPrice, sumLines } from "@/lib/money";
import { pctToFraction as pctParse } from "@/lib/validation";
import { buildItemSnapshots, type CatalogProduct } from "@/modules/quotes/pricing";
import { canTransition } from "@/modules/quotes/status";
import { collectedAt, commissionForSale, metTarget, netProfitByLine, type RateRow } from "@/modules/commissions/calc";
import { parseProductCsv } from "@/modules/products/import";
import { ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const D = (v: string | number) => new Prisma.Decimal(v);

describe("dinero", () => {
  it("evita errores de coma flotante", () => {
    const l = computeLine({ quantity: "3", unitPrice: "0.1", discountPct: "0", taxRate: "0.16" });
    expect(l.subtotal.toString()).toBe("0.3");
    expect(l.tax.toString()).toBe("0.05"); // 0.048 → 0.05 half-up
    expect(l.total.toString()).toBe("0.35");
  });

  it("aplica descuento antes de IVA y suma partidas exactas", () => {
    const a = computeLine({ quantity: "2", unitPrice: "1500", discountPct: "0.1", taxRate: "0.16" });
    expect([a.subtotal, a.discount, a.tax, a.total].map(String)).toEqual(["3000", "300", "432", "3132"]);
    const t = sumLines([a, computeLine({ quantity: "1", unitPrice: "19.99", discountPct: "0", taxRate: "0.16" })]);
    expect(t.total.toString()).toBe("3155.19"); // 3132 + 19.99 + 3.20
  });

  it("calcula precio de lista como la hoja de Excel", () => {
    expect(listPrice("1088", "1.02", "0").toString()).toBe("2197.76");
    expect(listPrice("100", "0.35", "25.5").toString()).toBe("160.5");
  });
});

const catalog = new Map<string, CatalogProduct>([
  ["p1", { id: "p1", sku: "SEP-1", description: "Separador", line: "REFACCIONES", kind: "PRODUCT", unit: "PZA", cost: D(1000), price: D(1500), taxRate: D("0.16"), status: "ACTIVE" }],
  ["p0", { id: "p0", sku: "SIN-PRECIO", description: "x", line: "REFACCIONES", kind: "PRODUCT", unit: "PZA", cost: D(0), price: D(0), taxRate: D("0.16"), status: "ACTIVE" }],
  ["px", { id: "px", sku: "INACT", description: "x", line: "KITS", kind: "PRODUCT", unit: "PZA", cost: D(1), price: D(2), taxRate: D("0.16"), status: "INACTIVE" }],
]);

describe("cotizaciones: precios del servidor", () => {
  const seller = { canOverridePrice: false };
  it("toma precio y costo del catálogo (instantánea)", () => {
    const { items, totals } = buildItemSnapshots([{ productId: "p1", quantity: "2", discountPct: "0" }], catalog, seller);
    expect(items[0].unitPrice.toString()).toBe("1500");
    expect(items[0].unitCost.toString()).toBe("1000");
    expect(totals.total.toString()).toBe("3480");
  });
  it("rechaza manipulación de precio sin permiso", () => {
    expect(() => buildItemSnapshots([{ productId: "p1", quantity: "1", discountPct: "0", unitPrice: "1" }], catalog, seller)).toThrow(/precio de lista/);
  });
  it("permite precio especial con permiso", () => {
    const { items } = buildItemSnapshots([{ productId: "p1", quantity: "1", discountPct: "0", unitPrice: "1200" }], catalog, { canOverridePrice: true });
    expect(items[0].unitPrice.toString()).toBe("1200");
  });
  it("sin tope de descuento por rol (lo autoriza un administrador); 100% o más es inválido", () => {
    expect(() => buildItemSnapshots([{ productId: "p1", quantity: "1", discountPct: "0.2" }], catalog, seller)).not.toThrow();
    expect(() => buildItemSnapshots([{ productId: "p1", quantity: "1", discountPct: "1" }], catalog, seller)).toThrow(/descuento inválido/);
  });
  it("rechaza cantidad ≤ 0, inactivos y precio 0", () => {
    expect(() => buildItemSnapshots([{ productId: "p1", quantity: "0", discountPct: "0" }], catalog, seller)).toThrow(/cantidad/);
    expect(() => buildItemSnapshots([{ productId: "px", quantity: "1", discountPct: "0" }], catalog, seller)).toThrow(/inactivo/);
    expect(() => buildItemSnapshots([{ productId: "p0", quantity: "1", discountPct: "0" }], catalog, seller)).toThrow(/no tiene precio/);
    expect(() => buildItemSnapshots([], catalog, seller)).toThrow();
  });
});

describe("transiciones de cotización", () => {
  it("solo permite flujos válidos", () => {
    expect(canTransition("DRAFT", "SENT")).toBe(true);
    expect(canTransition("SENT", "ACCEPTED")).toBe(true);
    expect(canTransition("DRAFT", "ACCEPTED")).toBe(false);
    expect(canTransition("ACCEPTED", "CONVERTED")).toBe(false); // solo vía venta
    expect(canTransition("CONVERTED", "CANCELLED")).toBe(false);
  });
});

describe("comisiones (meta mensual, cobro y utilidad neta)", () => {
  const rates: RateRow[] = [{ line: "SERVICIOS", rateMet: D("0.10"), rateNotMet: D("0.05") }, { line: "TUBERIA", rateMet: D("0.08"), rateNotMet: D("0.04") }];
  const L = (line: "SERVICIOS" | "TUBERIA", qty: string, sub: string, disc: string, cost: string) =>
    ({ line, quantity: D(qty), subtotal: D(sub), discount: D(disc), unitCost: D(cost) });

  it("la venta se considera cobrada cuando los pagos cubren el total", () => {
    const pays = [{ amount: D(600), paidAt: new Date("2026-10-20") }, { amount: D(400), paidAt: new Date("2026-11-03") }];
    expect(collectedAt(D(1000), pays)?.toISOString().slice(0, 10)).toBe("2026-11-03");
    expect(collectedAt(D(1000), pays.slice(0, 1))).toBeNull();
  });

  it("meta mensual: cumplida solo con meta > 0 y venta total ≥ meta", () => {
    expect(metTarget(D(100), D(100))).toBe(true);
    expect(metTarget(D(99.99), D(100))).toBe(false);
    expect(metTarget(D(500), D(0))).toBe(false);
  });

  it("comisión sobre utilidad neta después de gastos, prorrateados por línea", () => {
    const lines = [L("SERVICIOS", "1", "1000", "0", "400"), L("TUBERIA", "2", "1000", "100", "300")];
    const p = netProfitByLine(lines, D(190)); // neto 1000 y 900; utilidad 600 y 300; gastos 100 y 90
    expect(p.get("SERVICIOS")!.toString()).toBe("500");
    expect(p.get("TUBERIA")!.toString()).toBe("210");
  });

  it("aplica % alto o bajo según la meta del mes de la O.C.", () => {
    const lines = [L("SERVICIOS", "1", "1000", "0", "400")];
    expect(commissionForSale(lines, D(0), rates, true)[0].amount.toString()).toBe("60");
    expect(commissionForSale(lines, D(0), rates, false)[0].amount.toString()).toBe("30");
  });

  it("utilidad negativa no genera comisión", () => {
    const r = commissionForSale([L("SERVICIOS", "1", "100", "0", "150")], D(0), rates, true);
    expect(r[0].amount.toString()).toBe("0");
  });
});

describe("importación CSV (formato Lista precios)", () => {
  it("mapea Type a línea, calcula precio y reporta errores", () => {
    const csv = [
      "OEM Name,OEM Part #,Item #,Air Supply Number,Catalogo,Type,Costo,Utilidad,coste utilidad,Envio,Precio venta",
      ",-,,,-,NO APLICA,,0,0,,0",
      "ABAC,111,KD1,KD1,AIR/OIL SEPARATOR,REFACCIONES,1088,1.02,,,",
      "ABAC,222,K2,K2,KIT,KIT´S,100,0.5,,10,",
      "ABAC,333,S3,S3,SERV,SERVICIOS,,,,,3500",
      "ABAC,111,KD1,KD1,AIR/OIL SEPARATOR,REFACCIONES,1,1,,,",
      "ABAC,444,X,X,X,#N/A,1,1,,,",
    ].join("\n");
    const { rows, errors } = parseProductCsv(csv);
    expect(rows.map((r) => [r.sku, r.line, r.kind, r.price.toString()])).toEqual([
      ["ABAC-111", "REFACCIONES", "PRODUCT", "2197.76"],
      ["ABAC-222", "KITS", "PRODUCT", "160"],
      ["ABAC-333", "SERVICIOS", "SERVICE", "3500"],
    ]);
    expect(errors.map((e) => e.row)).toEqual([6, 7]);
  });
});

describe("roles", () => {
  it("ventas no gestiona usuarios ni sobrescribe precios; almacén no cotiza", () => {
    expect(ROLE_PERMISSIONS.VENTAS).not.toContain("users.manage");
    expect(ROLE_PERMISSIONS.VENTAS).not.toContain("quotes.override_price");
    expect(ROLE_PERMISSIONS.VENTAS).not.toContain("quotes.read_all");
    expect(ROLE_PERMISSIONS.ALMACEN).not.toContain("quotes.write");
    expect(ROLE_PERMISSIONS.GERENCIA).not.toContain("users.manage");
  });
});

describe("validación de entrada", async () => {
  const { decimalStr, pctToFraction } = await import("@/lib/validation");
  it("acepta decimales válidos y rechaza basura", () => {
    expect(decimalStr({ scale: 3 }).parse("2")).toBe("2");
    expect(decimalStr({ scale: 2 }).parse("$1,234.50")).toBe("1234.50");
    expect(decimalStr({ scale: 2 }).safeParse("1.234").success).toBe(false);
    expect(decimalStr().safeParse("1e3").success).toBe(false);
    expect(decimalStr({ min: 0 }).safeParse("-1").success).toBe(false);
    expect(pctToFraction.parse("3.5")).toBe("0.0350");
  });
});

describe("porcentaje de descuento", () => {
  it("acepta 10, 10%, 10,5 y 10.5", () => {
    expect(pctParse.parse("10")).toBe("0.1000");
    expect(pctParse.parse("10%")).toBe("0.1000");
    expect(pctParse.parse(" 10 % ")).toBe("0.1000");
    expect(pctParse.parse("10,5")).toBe("0.1050");
    expect(pctParse.parse("")).toBe("0.0000");
    expect(() => pctParse.parse("101")).toThrow();
    expect(() => pctParse.parse("abc")).toThrow();
  });
});
