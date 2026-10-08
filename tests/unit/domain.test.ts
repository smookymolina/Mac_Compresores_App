import { describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { computeLine, listPrice, sumLines } from "@/lib/money";
import { buildItemSnapshots, type CatalogProduct } from "@/modules/quotes/pricing";
import { canTransition } from "@/modules/quotes/status";
import { calculateCommissions, type RateRow } from "@/modules/commissions/calc";
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
  it("limita descuento sin permiso", () => {
    expect(() => buildItemSnapshots([{ productId: "p1", quantity: "1", discountPct: "0.2" }], catalog, seller)).toThrow(/descuento máximo/);
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

describe("comisiones (tabla verde/rojo)", () => {
  const rates: RateRow[] = [
    { line: "EQUIPO_VENTA", rateMet: D("0.10"), rateNotMet: D("0.07") },
    { line: "REFACCIONES", rateMet: D("0.07"), rateNotMet: D("0.035") },
  ];
  const lines = [
    { sellerId: "a", line: "EQUIPO_VENTA" as const, quantity: D(1), subtotal: D(100000), discount: D(0), unitCost: D(70000) },
    { sellerId: "a", line: "REFACCIONES" as const, quantity: D(10), subtotal: D(10000), discount: D(1000), unitCost: D(500) },
    { sellerId: "b", line: "REFACCIONES" as const, quantity: D(1), subtotal: D(5000), discount: D(0), unitCost: D(3000) },
  ];

  it("aplica tasa verde a todas las líneas si alcanza la meta", () => {
    const r = calculateCommissions("NET_SALES", lines, rates, new Map([["a", D(100000)], ["b", D(10000)]]));
    const a = r.filter((x) => x.sellerId === "a");
    expect(a.every((x) => x.metTarget)).toBe(true);
    expect(a.find((x) => x.line === "EQUIPO_VENTA")!.amount.toString()).toBe("10000");
    expect(a.find((x) => x.line === "REFACCIONES")!.amount.toString()).toBe("630"); // 9000 × 7%
    const b = r.find((x) => x.sellerId === "b")!;
    expect(b.metTarget).toBe(false);
    expect(b.amount.toString()).toBe("175"); // 5000 × 3.5%
  });

  it("sin meta registrada aplica tasa roja", () => {
    const r = calculateCommissions("NET_SALES", lines.slice(2), rates, new Map());
    expect(r[0].metTarget).toBe(false);
  });

  it("base margen descuenta costo", () => {
    const r = calculateCommissions("MARGIN", lines.slice(2), rates, new Map([["b", D(1)]]));
    expect(r[0].baseAmount.toString()).toBe("2000");
    expect(r[0].amount.toString()).toBe("140");
  });

  it("base cobranza no disponible", () => {
    expect(() => calculateCommissions("COLLECTED", lines, rates, new Map())).toThrow();
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
