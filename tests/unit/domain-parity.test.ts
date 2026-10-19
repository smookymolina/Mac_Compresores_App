import { Prisma } from "@prisma/client";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { AppError } from "@/domain/errors";
import { buildItemSnapshots, type CatalogProduct, type RequestedItem } from "@/domain/pricing";

// Paridad: el dominio debe dar exactamente lo mismo con Prisma.Decimal (servidor) que con decimal.js/strings (móvil).
type Raw = Omit<CatalogProduct, "cost" | "shipping" | "consumables" | "price" | "taxRate"> & {
  cost: string; shipping?: string; consumables?: string; price: string; taxRate: string;
};

const RAW: Raw[] = [
  { id: "p1", sku: "CMP-1", description: "Compresor", line: "EQUIPO_VENTA", kind: "PRODUCT", unit: "pza",
    cost: "10000.1234", shipping: "350.5", consumables: "12.345", currency: "MXN", price: "15999.99", taxRate: "0.16", status: "ACTIVE" },
  { id: "p2", sku: "TUB-1", description: "Tubería", line: "TUBERIA", kind: "PRODUCT", unit: "m",
    cost: "3.3333", shipping: "0.25", currency: "USD", price: "7.77", taxRate: "0.16", status: "ACTIVE" },
  { id: "p3", sku: "SRV-1", description: "Servicio", line: "SERVICIOS", kind: "SERVICE", unit: "hr",
    cost: "100", price: "333.33", taxRate: "0.08", status: "ACTIVE" },
  { id: "p4", sku: "OLD-1", description: "Inactivo", line: "REFACCIONES", kind: "PRODUCT", unit: "pza",
    cost: "1", price: "2", taxRate: "0.16", status: "INACTIVE" },
];

type Ctor = new (v: string) => unknown;
function catalog(C: Ctor | null): Map<string, CatalogProduct> {
  const w = (v: string | undefined) => (v === undefined ? undefined : C ? new C(v) : new Decimal(v));
  return new Map(
    RAW.map((r) => [r.id, { ...r, cost: w(r.cost), shipping: w(r.shipping), consumables: w(r.consumables),
      price: w(r.price), taxRate: w(r.taxRate) } as CatalogProduct]),
  );
}
const prismaCat = () => catalog(Prisma.Decimal as unknown as Ctor);
const plainCat = () => catalog(null);

const AMOUNT_KEYS = ["quantity", "unitPrice", "unitCost", "discountPct", "taxRate", "origUnitPrice", "fxRate",
  "subtotal", "discount", "tax", "total"] as const;

function dump(res: ReturnType<typeof buildItemSnapshots>) {
  return {
    items: res.items.map((i) => Object.fromEntries(AMOUNT_KEYS.map((k) => [k, i[k].toString()]))),
    totals: Object.fromEntries(Object.entries(res.totals).map(([k, v]) => [k, v.toString()])),
  };
}

const CASES: { name: string; req: RequestedItem[]; opts: { canOverridePrice: boolean; fx?: Decimal | null } }[] = [
  { name: "MXN sin descuento", req: [{ productId: "p1", quantity: "1", discountPct: "0" }], opts: { canOverridePrice: false } },
  { name: "MXN 15% y 3 decimales", req: [{ productId: "p1", quantity: "2.375", discountPct: "0.15" }], opts: { canOverridePrice: false } },
  { name: "USD con TC", req: [{ productId: "p2", quantity: "123.456", discountPct: "0.15" }], opts: { canOverridePrice: false, fx: new Decimal("17.2345") } },
  { name: "mixto", req: [
      { productId: "p1", quantity: "1.001", discountPct: "0.1" },
      { productId: "p2", quantity: "0.333", discountPct: "0" },
      { productId: "p3", quantity: "7.125", discountPct: "0.15", details: "  visita  " },
    ], opts: { canOverridePrice: false, fx: new Decimal("18.05") } },
  { name: "override permitido", req: [{ productId: "p3", quantity: "3.333", discountPct: "0.2", unitPrice: "299.995" }], opts: { canOverridePrice: true } },
  { name: "unitPrice igual a lista sin permiso", req: [{ productId: "p3", quantity: "1", discountPct: "0", unitPrice: "333.33" }], opts: { canOverridePrice: false } },
];

describe("paridad Prisma.Decimal vs decimal.js en buildItemSnapshots", () => {
  it.each(CASES)("$name", ({ req, opts }) => {
    const a = buildItemSnapshots(req, prismaCat(), { ...opts, fx: opts.fx ? new Prisma.Decimal(opts.fx.toString()) as unknown as Decimal : opts.fx });
    const b = buildItemSnapshots(req, plainCat(), opts);
    expect(dump(a)).toEqual(dump(b));
    // Ida y vuelta por Prisma.Decimal (lo que se escribe en BD) no altera valores.
    for (const res of [a, b]) {
      for (const i of res.items) for (const k of AMOUNT_KEYS) {
        const p = new Prisma.Decimal(i[k] as unknown as Prisma.Decimal.Value);
        expect(p.toString()).toBe(i[k].toString());
        expect(p.eq(i[k].toString())).toBe(true);
      }
      for (const v of Object.values(res.totals)) expect(new Prisma.Decimal(v as unknown as Prisma.Decimal.Value).toString()).toBe(v.toString());
    }
  });

  it("valores conocidos (USD con TC)", () => {
    const r = buildItemSnapshots([{ productId: "p2", quantity: "123.456", discountPct: "0.15" }], plainCat(),
      { canOverridePrice: false, fx: new Decimal("17.2345") });
    expect(r.items[0].unitPrice.toString()).toBe("133.91"); // 7.77*17.2345=133.912065
  });

  const ERRORS: { name: string; req: RequestedItem[]; opts: { canOverridePrice: boolean; fx?: Decimal | null }; msg: RegExp }[] = [
    { name: "override prohibido", req: [{ productId: "p3", quantity: "1", discountPct: "0", unitPrice: "100" }], opts: { canOverridePrice: false }, msg: /no puedes modificar/ },
    { name: "producto inactivo", req: [{ productId: "p4", quantity: "1", discountPct: "0" }], opts: { canOverridePrice: false }, msg: /inactivo/ },
    { name: "descuento de 100%", req: [{ productId: "p1", quantity: "1", discountPct: "1" }], opts: { canOverridePrice: false }, msg: /descuento inválido/ },
    { name: "USD sin TC", req: [{ productId: "p2", quantity: "1", discountPct: "0" }], opts: { canOverridePrice: false }, msg: /tipo de cambio/ },
  ];
  it.each(ERRORS)("error idéntico: $name", ({ req, opts, msg }) => {
    for (const cat of [prismaCat(), plainCat()]) {
      let err: unknown;
      try { buildItemSnapshots(req, cat, opts); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(AppError);
      expect((err as Error).message).toMatch(msg);
    }
  });
});
