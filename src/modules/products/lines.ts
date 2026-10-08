import type { ProductKind, ProductLine } from "@prisma/client";

export const LINE_LABEL: Record<ProductLine, string> = {
  EQUIPO_VENTA: "Venta de equipos nuevos o usados",
  RENTA: "Renta de equipos",
  REFACCIONES: "Refacciones (filtros, separadores, drenes, lubricantes)",
  TUBERIA: "Tubería e instalaciones neumáticas",
  SERVICIOS: "Servicios (pistón o tornillo)",
  KITS: "Kits para compresores tipo tornillo",
  VALVULAS_OTROS: "Válvulas, poleas, bandas, conexiones, etc.",
};

export const LINES = Object.keys(LINE_LABEL) as ProductLine[];

/** Columna "Type" de la Lista de precios → línea comercial. */
export function lineFromExcelType(raw: string): { line: ProductLine; kind: ProductKind } | null {
  const t = raw
    .normalize("NFD")
    .replace(/[^A-Za-z]/g, "")
    .toUpperCase();
  switch (t) {
    case "REFACCIONES":
      return { line: "REFACCIONES", kind: "PRODUCT" };
    case "KITS":
    case "KIT":
      return { line: "KITS", kind: "PRODUCT" };
    case "VENTA":
      return { line: "EQUIPO_VENTA", kind: "PRODUCT" };
    case "TUBERIA":
      return { line: "TUBERIA", kind: "PRODUCT" };
    case "OTROS":
      return { line: "VALVULAS_OTROS", kind: "PRODUCT" };
    case "SERVICIOS":
      return { line: "SERVICIOS", kind: "SERVICE" };
    case "RENTA":
      return { line: "RENTA", kind: "SERVICE" };
    default:
      return (Object.keys(LINE_LABEL) as string[]).includes(raw.trim().toUpperCase())
        ? { line: raw.trim().toUpperCase() as ProductLine, kind: "PRODUCT" }
        : null;
  }
}
