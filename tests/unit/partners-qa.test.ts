// QA v1.4.0 (Agente 9): casos de borde del precio de socio (half-up exacto con Decimal, sin errores de float).
import { describe, expect, it } from "vitest";
import { D } from "@/lib/money";
import { clientIp } from "@/lib/request";
import { effectiveDiscount, getPartnerPrice } from "@/modules/partners/pricing";

describe("getPartnerPrice: redondeo half-up y bordes", () => {
  it.each([
    ["10.05", 50, "5.03"], // 5.025 exacto → arriba (en float sería 5.02)
    ["1.005", 0, "1.01"], // 1.005 en float es 1.00499…
    ["0.01", 50, "0.01"], // 0.005 → 0.01
    ["19.99", 15, "16.99"], // 16.9915
    ["2.50", 15.5, "2.11"], // 2.1125
    ["7391.37", 20, "5913.10"], // 5913.096
    ["7391.37", 15, "6282.66"], // 6282.6645
    ["48.20", 20, "38.56"], // USD TUBERIA
    ["48.20", 15, "40.97"], // 40.97
    ["999999.99", 60, "400000.00"], // tope del descuento
    ["100", "12.34", "87.66"],
  ])("%s con %s%% → %s", (price, pct, out) => {
    expect(getPartnerPrice(price, pct).toFixed(2)).toBe(out);
  });
  it("el monto nunca es negativo ni cambia de moneda (no hay conversión)", () => {
    expect(getPartnerPrice("0.01", 60).toFixed(2)).toBe("0.00");
    expect(getPartnerPrice(new D("48.20"), 0).toFixed(2)).toBe("48.20");
  });
  it("override del socio gana sobre el global; null/undefined usa el global", () => {
    expect(getPartnerPrice("1000", effectiveDiscount({ discountPct: new D(10) }, { discountPct: new D(20) })).toFixed(2)).toBe("900.00");
    expect(getPartnerPrice("1000", effectiveDiscount({ discountPct: null }, { discountPct: new D(20) })).toFixed(2)).toBe("800.00");
    expect(getPartnerPrice("1000", effectiveDiscount({ discountPct: "0" }, { discountPct: new D(20) })).toFixed(2)).toBe("1000.00");
  });
});

describe("clientIp: no se deja falsificar con X-Forwarded-For", () => {
  it("prefiere X-Real-IP (la fija nginx) y si falta usa el último valor de XFF", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9", "x-real-ip": "9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers())).toBe("desconocida");
  });
});
