import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/lib/csv";

describe("CSV", () => {
  it("escapa comillas, comas y saltos de línea", () => {
    expect(csvCell('Compresor "Atlas", 15 HP')).toBe('"Compresor ""Atlas"", 15 HP"');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });
  it("neutraliza fórmulas pero conserva números negativos", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-12.50")).toBe("-12.50");
    expect(csvCell(null)).toBe("");
  });
  it("incluye BOM y CRLF para Excel", () => {
    expect(toCsv(["A", "B"], [[1, "x"]])).toBe("﻿A,B\r\n1,x\r\n");
  });
});
