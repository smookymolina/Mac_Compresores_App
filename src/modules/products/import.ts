import Papa from "papaparse";
import type { ProductKind, ProductLine } from "@prisma/client";
import { dec, listPrice, type Dec } from "@/lib/money";
import { lineFromExcelType } from "./lines";

export interface ImportRow {
  sku: string;
  oemName: string | null;
  oemPartNumber: string | null;
  supplierCode: string | null;
  description: string;
  category: string | null;
  line: ProductLine;
  kind: ProductKind;
  unit: string;
  cost: Dec;
  markup: Dec;
  shipping: Dec;
  price: Dec;
  taxRate: Dec;
}

export interface ParseResult {
  rows: ImportRow[];
  errors: { row: number; message: string }[];
}

const norm = (s: string) => s.normalize("NFD").replace(/[^a-zA-Z0-9]/g, "").toLowerCase();

// Encabezados aceptados: los de la hoja "Lista precios" y un formato simple propio.
const ALIASES: Record<string, string[]> = {
  sku: ["sku", "clave"],
  oemName: ["oemname", "marca"],
  oemPartNumber: ["oempart", "oempartno", "numerodeparte"],
  supplierCode: ["item", "itemno"],
  airSupply: ["airsupplynumber"],
  description: ["descripcion", "description"],
  category: ["catalogo", "categoria", "category"],
  type: ["type", "tipo", "linea"],
  unit: ["unidad", "unit"],
  cost: ["costo", "cost"],
  markup: ["utilidad", "markup"],
  shipping: ["envio", "shipping"],
  price: ["precioventa", "precio", "price"],
  taxRate: ["iva", "impuesto", "taxrate"],
};

function num(v: string | undefined): Dec | null {
  if (v === undefined) return null;
  const s = v.replace(/[$,\s]/g, "");
  if (s === "" || s === "-") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return dec(s);
}

export function parseProductCsv(text: string): ParseResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
  const [header, ...data] = parsed.data;
  const errors: ParseResult["errors"] = [];
  if (!header) return { rows: [], errors: [{ row: 0, message: "Archivo vacío." }] };

  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const n = norm(h);
    for (const [key, al] of Object.entries(ALIASES)) if (al.includes(n) && idx[key] === undefined) idx[key] = i;
  });
  if (idx.type === undefined || (idx.sku === undefined && idx.oemPartNumber === undefined)) {
    return { rows: [], errors: [{ row: 1, message: "Faltan columnas: Type y (SKU u OEM Part #)." }] };
  }

  const rows: ImportRow[] = [];
  const seen = new Set<string>();
  data.forEach((r, i) => {
    const rowNo = i + 2;
    const get = (k: string) => (idx[k] === undefined ? undefined : (r[idx[k]] ?? "").trim());
    const oemName = get("oemName") || null;
    const oemPart = get("oemPartNumber") || null;
    if ((!oemPart || oemPart === "-") && !get("sku")) return; // filas de relleno

    const sku = (get("sku") || [oemName, oemPart].filter(Boolean).join("-")).toUpperCase().slice(0, 80);
    const typed = lineFromExcelType(get("type") ?? "");
    if (!typed) return errors.push({ row: rowNo, message: `Tipo no reconocido: "${get("type")}"` });
    if (seen.has(sku)) return errors.push({ row: rowNo, message: `SKU duplicado en el archivo: ${sku}` });

    const cost = num(get("cost")) ?? dec(0);
    const markup = num(get("markup")) ?? dec(0);
    const shipping = num(get("shipping")) ?? dec(0);
    const price = num(get("price")) ?? listPrice(cost, markup, shipping);
    const taxRate = num(get("taxRate")) ?? dec("0.16");
    if (cost.lt(0) || price.lt(0)) return errors.push({ row: rowNo, message: "Costo o precio negativo." });
    if (taxRate.lt(0) || taxRate.gt(1)) return errors.push({ row: rowNo, message: "IVA debe ser fracción (0.16)." });

    const category = get("category") || null;
    const description =
      get("description") || [category, oemName, oemPart && `(${oemPart})`].filter(Boolean).join(" ") || sku;

    seen.add(sku);
    rows.push({
      sku,
      oemName,
      oemPartNumber: oemPart,
      supplierCode: get("supplierCode") || get("airSupply") || null,
      description: description.slice(0, 300),
      category,
      ...typed,
      unit: get("unit") || (typed.kind === "SERVICE" ? "SERV" : "PZA"),
      cost,
      markup,
      shipping,
      price,
      taxRate,
    });
  });
  return { rows, errors };
}
