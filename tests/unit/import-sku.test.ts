import { describe, expect, it } from "vitest";
import { parseProductCsv } from "@/modules/products/import";

describe("SKU del importador", () => {
  it("no deja símbolos al inicio o al final", () => {
    const csv = "OEM Name,OEM Part #,Catalogo,Type,Costo,Utilidad,Precio venta\n-,.-CSC-10SE,COMPRESOR,VENTA,100,0.3,130\n-,MILW100SG,SECADOR,VENTA,100,0.3,130\n";
    const { rows } = parseProductCsv(csv);
    expect(rows.map((r) => r.sku)).toEqual(["CSC-10SE", "MILW100SG"]);
  });
});
