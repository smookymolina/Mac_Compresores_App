import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from "pdf-lib";
import { dec, fmtMoney, fmtPct } from "@/lib/money";
import { fmtDate } from "@/lib/utils";
import { warrantyText, type QuoteComplement } from "@/modules/complements/match";

/**
 * Renderizador PURO del PDF de cotización (sin fs, BD ni env): recibe los datos ya presentados
 * (montos en la moneda de la cotización, ver `presentQuote`) y los bytes de las imágenes.
 * Reutilizable fuera del servidor (p. ej. app móvil).
 */

/** Valor decimal ya calculado (Prisma.Decimal, decimal.js, string…): solo se usa su `toString()`. */
export type DecimalLike = { toString(): string };

export interface QuotePdfItem {
  sku: string;
  description: string;
  details?: string | null;
  quantity: DecimalLike;
  unitPrice: DecimalLike;
  discountPct: DecimalLike;
  /** subtotal − descuento de la partida. */
  lineTotal: DecimalLike;
  origCurrency: string;
  /** Precio de lista original en USD ya formateado a 2 decimales (o null). */
  origUnitPrice: string | null;
  /** TC de la partida ya formateado a 4 decimales. */
  fxRate: string;
}

export interface QuotePdfData {
  folio: number | string;
  currency: string;
  /** TC de la cotización ya formateado a 4 decimales (o null). */
  exchangeRate: string | null;
  createdAt: Date | string;
  validUntil: Date | string;
  deliveryTime: string | null;
  warrantyMonths: number | null;
  notes: string | null;
  customer: { legalName: string; rfc: string | null; contactName: string | null };
  items: QuotePdfItem[];
  /** Paquetes elegidos; null = cotización previa sin complementos guardados (se infiere el de 8000 h). */
  complements: QuoteComplement[] | null;
  /** subtotal − descuentos. */
  net: DecimalLike;
  taxTotal: DecimalLike;
  total: DecimalLike;
  /** Líneas de datos bancarios (vacío = se omite la sección). */
  bankInfo: string[];
}

export interface QuotePdfAssets {
  headerPng: Uint8Array;
  footerPng: Uint8Array;
  milwaukeeJpg: Uint8Array;
  /** Bloque/firma del asesor (PNG), opcional. */
  sellerBlockPng?: Uint8Array | null;
}

type Color = ReturnType<typeof rgb>;

// Formato oficial de cotización de MAC Compresores (mismo contenido que la plantilla de Excel, sin firma de
// cotizador). Paleta de maccompresores.com.mx.
const hex = (h: string) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);
const BRAND = hex("#046bd2");
const SLATE9 = hex("#1e293b");
const SLATE7 = hex("#334155");
const SLATE5 = hex("#64748b");
const LINE = hex("#e2e8f0");
const ZEBRA = hex("#f7f9fc");
const TINT = hex("#f0f5fa");
const WHITE = rgb(1, 1, 1);

/** Alcance del servicio de 8000 h (sección «Complementos» de la plantilla). */
const SERVICE_8000 = [
  "Sustitución del filtro de aire",
  "Sustitución del filtro de aceite",
  "Sustitución del separador (según indicaciones del fabricante)",
  "Mantenimiento a control eléctrico",
  "Reapriete de conexiones eléctricas",
  "Reapriete de conexiones neumáticas",
  "Inspección visual del estado de las mangueras",
  "Lavado a presión del enfriador",
  "Inspección del nivel de aceite",
  "Medición de parámetros eléctricos",
  "Limpieza general",
  "Reporte de servicio del estado determinado en las inspecciones",
  "Reporte termográfico",
  "Engrasado de rodamientos / motor (si el motor lo permite)",
  "Sustitución de lubricante",
  "Alineación, tensión e inspección de bandas (transmisión por bandas)",
  "Alineación de motor y unidad de compresor (transmisión directa)",
  "Inspección de poleas",
  "Reporte general",
];

const TERMS = [
  "La vigencia de nuestra cotización es de 15 días.",
  "Forma de pago: 100 % anticipado.",
  "Entrega: de 4 a 5 días hábiles. Equipos para entrega inmediata: considerar el tiempo de envío por paquetería. Acreditando pago.",
  "Garantía: 3 meses en unidades nuevas. En refacciones, por defecto de fábrica o de servicio a servicio (como lo marca el manual), directo con nosotros.",
  "En partes eléctricas no hay garantía.",
  "No incluye maniobra de descarga.",
  "Toda cotización que sea procesada a orden de compra y sea cancelada por el cliente genera un cargo del 20 % de su valor total por concepto de gastos administrativos.",
  "Ficha técnica anexada aparte por su asesor de ventas (solo aplica para cotizaciones de equipos nuevos).",
  "Si la cotización es en USD, se facturará en MXN al tipo de cambio vigente del día.",
  "Todos los precios indicados en la presente cotización están expresados en moneda nacional (MXN, pesos mexicanos).",
];

const isService8000 = (i: { sku: string; description: string }) => /8000/.test(i.sku) || /8000\s*h/i.test(i.description);

// Las fuentes estándar usan WinAnsi: se sustituyen caracteres no representables.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•€]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  // Saltos de línea y tabuladores (comunes en descripciones de Excel) antes de sanear: si no, salen como "?".
  for (const para of text.replace(/\r\n?/g, "\n").replace(/\t/g, " ").split("\n").map(safe)) {
    let cur = "";
    for (const w of para.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) <= width) { cur = next; continue; }
      if (cur) lines.push(cur);
      // Palabra más ancha que la columna (p. ej. SKU largo): se corta por caracteres.
      let rest = w;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let n = rest.length - 1;
        while (n > 1 && font.widthOfTextAtSize(rest.slice(0, n), size) > width) n--;
        lines.push(rest.slice(0, n));
        rest = rest.slice(n);
      }
      cur = rest;
    }
    lines.push(cur);
  }
  return lines;
}

export async function renderQuotePdf(data: QuotePdfData, assets: QuotePdfAssets): Promise<Uint8Array> {
  const q = data;
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cotización C-${q.folio}`);
  pdf.setAuthor("MAC Compresores");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const headerImg = await pdf.embedPng(assets.headerPng);
  const footerImg = await pdf.embedPng(assets.footerPng);
  const sellerBlock = assets.sellerBlockPng ? await pdf.embedPng(assets.sellerBlockPng) : null;
  const milwaukee: PDFImage = await pdf.embedJpg(assets.milwaukeeJpg);

  const W = 612;
  const H = 792;
  const M = 36;
  const R = W - M;
  const FOOT = 34; // reserva inferior para el pie
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: Color; align?: "right" | "center" } = {}) => {
    const size = o.size ?? 9;
    const f = o.f ?? font;
    const str = safe(s);
    const w = f.widthOfTextAtSize(str, size);
    const xx = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    page.drawText(str, { x: xx, y: yy, size, font: f, color: o.color ?? SLATE9 });
  };
  const rect = (x: number, yy: number, w: number, h: number, color: Color, border?: Color) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color, ...(border && { borderColor: border, borderWidth: 0.6 }) });
  const hline = (yy: number, x1 = M, x2 = R, color = LINE, t = 0.6) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: t, color });

  // ---- Encabezado ----
  const headerW = R - M;
  const headerH = (headerImg.height / headerImg.width) * headerW;
  page.drawImage(headerImg, { x: M, y: y - headerH, width: headerW, height: headerH });
  y -= headerH + 14;
  text("COTIZACIÓN", R, y - 4, { size: 20, f: bold, align: "right" });
  text(`Folio C-${q.folio}`, R, y - 18, { size: 10, color: SLATE5, align: "right" });
  y -= 26;

  // ---- Ficha: empresa / cliente / folio / fecha ----
  const leftW = 360;
  const rows: [string, string, string, string][] = [
    ["Empresa", q.customer.legalName, "Folio", `C-${q.folio}`],
    ["Cliente", q.customer.contactName ?? "—", "Fecha", fmtDate(q.createdAt)],
    ["RFC", q.customer.rfc ?? "—", "Vigencia", fmtDate(q.validUntil)],
  ];
  const rowH = 16;
  rect(M, y - rows.length * rowH, R - M, rows.length * rowH, WHITE, LINE);
  rows.forEach(([k1, v1, k2, v2], i) => {
    const top = y - i * rowH;
    rect(M, top - rowH, 62, rowH, TINT);
    rect(M + leftW, top - rowH, 62, rowH, TINT);
    if (i > 0) hline(top);
    const by = top - 11.5;
    text(k1, M + 8, by, { f: bold, size: 8.5, color: SLATE7 });
    text(wrap(v1, font, 9.5, leftW - 80)[0] ?? "", M + 70, by, { size: 9.5 });
    text(k2, M + leftW + 8, by, { f: bold, size: 8.5, color: SLATE7 });
    text(v2, M + leftW + 70, by, { size: 9.5, f: k2 === "Folio" ? bold : font });
  });
  y -= rows.length * rowH;
  // Tiempo de entrega: renglón a todo lo ancho (el texto puede ser largo).
  if (q.deliveryTime) {
    const lines = wrap(q.deliveryTime, font, 9.5, R - M - 80);
    const h = Math.max(rowH, lines.length * 12 + 4);
    rect(M, y - h, R - M, h, WHITE, LINE);
    rect(M, y - h, 62, h, TINT); // mismo ancho de etiqueta que la ficha
    text("Entrega", M + 8, y - 11.5, { f: bold, size: 8.5, color: SLATE7 });
    lines.forEach((l, k) => text(l, M + 70, y - 11.5 - k * 12, { size: 9.5 }));
    y -= h;
  }
  y -= 14;

  // ---- Partidas ----
  const col = { sku: M, desc: M + 104, qty: 392, price: 462, disc: 512, total: R };
  const pad = 6;
  const header = () => {
    rect(M, y - 20, R - M, 20, SLATE9);
    const hy = y - 13.5;
    const o = { f: bold, size: 8.5, color: WHITE } as const;
    text("SKU", col.sku + pad, hy, o);
    text("Descripción", col.desc + pad, hy, o);
    text("Cant.", col.qty - pad, hy, { ...o, align: "right" });
    text("Precio", col.price - pad, hy, { ...o, align: "right" });
    text("Desc.", col.disc - pad, hy, { ...o, align: "right" });
    text("Total", col.total - pad, hy, { ...o, align: "right" });
    y -= 20;
  };
  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
    text(`Cotización C-${q.folio} (continuación)`, M, y - 10, { f: bold, size: 10 });
    y -= 24;
  };
  const ensure = (h: number, onBreak?: () => void) => {
    if (y - h < M + FOOT) { newPage(); onBreak?.(); }
  };

  header();
  q.items.forEach((i, idx) => {
    const size = 9;
    const skuLines = wrap(i.sku, bold, 8.5, col.desc - col.sku - pad * 2);
    const descW = col.qty - 40 - col.desc - pad * 2;
    const descLines = [
      ...wrap(i.description, font, size, descW),
      ...(q.currency !== "USD" && i.origCurrency === "USD" && i.origUnitPrice
        ? [`USD ${i.origUnitPrice} × TC ${i.fxRate}`] : []),
      // Actividades/alcance del servicio capturadas en la cotización.
      ...(i.details ?? "").split(/\r?\n/).filter((l) => l.trim()).flatMap((l) => wrap(`• ${l.trim()}`, font, size, descW)),
    ];
    const h = Math.max(skuLines.length, descLines.length) * 11 + 8;
    ensure(h, header);
    if (idx % 2 === 1) rect(M, y - h, R - M, h, ZEBRA);
    const ty = y - 12;
    skuLines.forEach((l, k) => text(l, col.sku + pad, ty - k * 11, { f: bold, size: 8.5 }));
    descLines.forEach((l, k) => text(l, col.desc + pad, ty - k * 11, { size, color: SLATE7 }));
    text(`${i.quantity.toString()}`, col.qty - pad, ty, { align: "right" });
    text(fmtMoney(i.unitPrice.toString()), col.price - pad, ty, { align: "right" });
    text(dec(i.discountPct.toString()).isZero() ? "—" : fmtPct(i.discountPct.toString()), col.disc - pad, ty, { align: "right" });
    text(fmtMoney(i.lineTotal.toString()), col.total - pad, ty, { align: "right", f: bold });
    y -= h;
    hline(y);
  });
  y -= 12;

  // ---- Complementos (paquetes elegidos; las cotizaciones previas conservan el de 8000 h) ----
  const services = q.items.filter(isService8000);
  const packs: QuoteComplement[] = q.complements
    ? q.complements
    : services.length > 0 ? [{ code: services.map((s) => s.sku).join(", "), name: "", activities: SERVICE_8000 }] : [];
  if (packs.length > 0) {
    ensure(22 + 30);
    rect(M, y - 20, R - M, 20, TINT);
    text("Complementos", M + pad, y - 13.5, { f: bold, size: 9.5, color: BRAND });
    text("Alcance incluido en el servicio", R - pad, y - 13.5, { size: 8, color: SLATE5, align: "right" });
    y -= 20;
  }
  for (const pk of packs) {
    const half = Math.ceil(pk.activities.length / 2);
    const colW = (R - M - 96) / 2 - 8;
    const listLines = (from: number, to: number) =>
      pk.activities.slice(from, to).map((s, k) => ({ n: from + k + 1, lines: wrap(s, font, 8, colW - 16) }));
    const LH = 9.5;
    const left = listLines(0, half);
    const right = listLines(half, pk.activities.length);
    const colH = (xs: typeof left) => xs.reduce((a, x) => a + x.lines.length * LH + 1.5, 0);
    const custom = pk.code.startsWith("PERSONALIZADO");
    const label = wrap(custom ? pk.name || "Personalizado" : pk.code, bold, 8.5, 80);
    const nameLines = pk.name && !custom ? wrap(pk.name, font, 7.5, 80) : [];
    const bodyH = Math.max(colH(left), colH(right), label.length * 10 + nameLines.length * 9) + 12;
    ensure(bodyH);
    rect(M, y - bodyH, R - M, bodyH, WHITE, LINE);
    label.forEach((l, k) => text(l, M + pad, y - 16 - k * 10, { f: bold, size: 8.5 }));
    nameLines.forEach((l, k) => text(l, M + pad, y - 16 - label.length * 10 - k * 9, { size: 7.5, color: SLATE5 }));
    const drawCol = (xs: typeof left, x: number) => {
      let yy = y - 16;
      for (const it of xs) {
        text(`${it.n}.`, x + 12, yy, { size: 8, color: SLATE5, align: "right" });
        it.lines.forEach((l, k) => text(l, x + 16, yy - k * LH, { size: 8, color: SLATE7 }));
        yy -= it.lines.length * LH + 1.5;
      }
    };
    drawCol(left, M + 96);
    drawCol(right, M + 96 + colW + 16);
    y -= bodyH;
  }
  if (packs.length > 0) y -= 12;

  // ---- Totales + distribuidores oficiales ----
  const net = q.net.toString();
  const boxW = 210;
  const bx = R - boxW;
  ensure(84);
  const tRows: [string, string][] = [["Subtotal", fmtMoney(net)], ["Impuestos", fmtMoney(q.taxTotal.toString())]];
  tRows.forEach(([k, v], i) => {
    const top = y - i * 18;
    text(k, bx + pad, top - 12.5, { color: SLATE7 });
    text(v, R - pad, top - 12.5, { align: "right" });
    hline(top - 18, bx, R);
  });
  const ty = y - tRows.length * 18;
  rect(bx, ty - 24, boxW, 24, SLATE9);
  text(`Total ${q.currency}`, bx + pad, ty - 16, { f: bold, size: 10, color: WHITE });
  text(fmtMoney(q.total.toString()), R - pad, ty - 16, { f: bold, size: 12, color: WHITE, align: "right" });

  text("Distribuidores oficiales", M, y - 12.5, { f: bold, size: 8.5, color: SLATE7 });
  const mwH = 34;
  page.drawImage(milwaukee, { x: M, y: y - 22 - mwH, width: (milwaukee.width / milwaukee.height) * mwH, height: mwH });
  y = ty - 24 - 12;

  // ---- Bloque de asesor (firma de quien atiende la cotización) ----
  if (sellerBlock) {
    const bw = 230;
    const bh = (sellerBlock.height / sellerBlock.width) * bw;
    ensure(bh + 12);
    page.drawImage(sellerBlock, { x: M, y: y - bh, width: bw, height: bh });
    y -= bh + 12;
  }

  // ---- Notas de la cotización ----
  if (q.notes) {
    const lines = wrap(q.notes, font, 8.5, R - M - pad * 2);
    ensure(lines.length * 11 + 22);
    text("Notas", M, y - 10, { f: bold, size: 9 });
    y -= 22;
    lines.forEach((l) => { text(l, M, y, { size: 8.5, color: SLATE7 }); y -= 11; });
    y -= 8;
  }

  // ---- Datos bancarios (líneas ya separadas; se omite si no hay) ----
  const bank = q.bankInfo;
  if (bank.length > 0) {
    ensure(bank.length * 11 + 22);
    text("Datos bancarios", M, y - 10, { f: bold, size: 9 });
    y -= 22;
    bank.forEach((l) => { text(l, M, y, { size: 8.5, color: SLATE7 }); y -= 11; });
    y -= 8;
  }

  // ---- Términos y condiciones (A–J) ----
  // Si la cotización trae tiempo de entrega, sustituye la cláusula genérica de entrega.
  // Igual con la garantía elegida (cláusula D).
  const terms = TERMS.map((t) =>
    t.startsWith("Entrega:") && q.deliveryTime ? `Entrega: ${q.deliveryTime}. Equipos para entrega inmediata: considerar el tiempo de envío por paquetería. Acreditando pago.`
    : t.startsWith("Garantía:") && q.warrantyMonths != null ? t.replace("3 meses", warrantyText(q.warrantyMonths))
    : t.startsWith("Todos los precios") && q.currency === "USD"
      ? `Todos los precios indicados en la presente cotización están expresados en dólares estadounidenses (USD)${q.exchangeRate ? `; tipo de cambio de referencia: ${q.exchangeRate} MXN por USD` : ""}.`
    : t);
  const termLines = terms.map((t, i) => ({ k: String.fromCharCode(65 + i), lines: wrap(t, font, 7.5, R - M - 34) }));
  const termsH = termLines.reduce((a, t) => a + t.lines.length * 9 + 1.5, 0) + 26;
  ensure(termsH);
  rect(M, y - termsH, R - M, termsH, TINT);
  text("Términos y condiciones", M + 10, y - 14, { f: bold, size: 9 });
  let yy = y - 27;
  for (const t of termLines) {
    text(`${t.k}.`, M + 10, yy, { f: bold, size: 7.5, color: SLATE7 });
    t.lines.forEach((l, k) => text(l, M + 24, yy - k * 9, { size: 7.5, color: SLATE7 }));
    yy -= t.lines.length * 9 + 1.5;
  }

  // ---- Pie: imagen de marca en cada página y numeración ----
  const footerW = R - M;
  const footerH = Math.min((footerImg.height / footerImg.width) * footerW, 26);
  pdf.getPages().forEach((p, idx, all) => {
    p.drawImage(footerImg, { x: M, y: 8, width: footerW, height: footerH });
    const pg = safe(`Página ${idx + 1} de ${all.length}`);
    p.drawText(pg, { x: R - font.widthOfTextAtSize(pg, 7.5), y: 2, size: 7.5, font, color: SLATE5 });
  });
  return pdf.save();
}
