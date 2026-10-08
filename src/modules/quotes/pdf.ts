import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { getQuote } from "./service";
import { fmtMoney, fmtPct } from "@/lib/money";
import { fmtDate } from "@/lib/utils";

type QuoteFull = Awaited<ReturnType<typeof getQuote>>;

const BRAND = rgb(0.016, 0.42, 0.824); // #046bd2
const INK = rgb(0.118, 0.161, 0.231);
const SOFT = rgb(0.45, 0.5, 0.56);

// Las fuentes estándar usan WinAnsi: se sustituyen caracteres no representables.
const safe = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF–—‘’“”•€]/g, "?");

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = safe(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function renderQuotePdf(q: QuoteFull): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Cotización C-${q.folio}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(await readFile(path.join(process.cwd(), "public/brand/logo-h.png")));

  let page: PDFPage = pdf.addPage([612, 792]);
  const M = 40;
  let y = 752;
  const text = (s: string, x: number, yy: number, o: { size?: number; f?: PDFFont; color?: ReturnType<typeof rgb>; right?: boolean } = {}) => {
    const size = o.size ?? 9;
    const f = o.f ?? font;
    const str = safe(s);
    const xx = o.right ? x - f.widthOfTextAtSize(str, size) : x;
    page.drawText(str, { x: xx, y: yy, size, font: f, color: o.color ?? INK });
  };

  page.drawImage(logo, { x: M, y: y - 40, width: 160, height: 43 });
  text("COTIZACIÓN", 572, y - 10, { size: 16, f: bold, color: BRAND, right: true });
  text(`Folio C-${q.folio}`, 572, y - 26, { size: 10, right: true });
  text(`Fecha: ${fmtDate(q.createdAt)}   Vigencia: ${fmtDate(q.validUntil)}`, 572, y - 40, { right: true });
  y -= 70;

  page.drawRectangle({ x: M, y: y - 52, width: 532, height: 58, color: rgb(0.94, 0.96, 0.98) });
  text("Cliente", M + 8, y - 8, { f: bold, color: SOFT, size: 8 });
  text(q.customer.legalName, M + 8, y - 22, { f: bold, size: 11 });
  text(`RFC: ${q.customer.rfc ?? "—"}`, M + 8, y - 35);
  const addr = q.customer.addresses[0];
  if (addr) text([addr.street, addr.city, addr.state].filter(Boolean).join(", "), M + 8, y - 47);
  text("Atendió", 400, y - 8, { f: bold, color: SOFT, size: 8 });
  text(q.seller.name, 400, y - 22);
  text(q.seller.email, 400, y - 35);
  y -= 72;

  const cols = { n: M, desc: M + 22, qty: 370, price: 440, disc: 490, amt: 572 };
  const header = () => {
    page.drawRectangle({ x: M, y: y - 4, width: 532, height: 16, color: BRAND });
    const w = rgb(1, 1, 1);
    text("#", cols.n + 4, y, { f: bold, color: w });
    text("Concepto", cols.desc, y, { f: bold, color: w });
    text("Cant.", cols.qty, y, { f: bold, color: w, right: true });
    text("P. unitario", cols.price, y, { f: bold, color: w, right: true });
    text("Desc.", cols.disc, y, { f: bold, color: w, right: true });
    text("Importe", cols.amt - 4, y, { f: bold, color: w, right: true });
    y -= 18;
  };
  header();

  for (const i of q.items) {
    const lines = wrap(`${i.sku} — ${i.description}`, font, 9, cols.qty - cols.desc - 40);
    if (y - lines.length * 11 < 140) {
      page = pdf.addPage([612, 792]);
      y = 752;
      header();
    }
    text(String(i.position), cols.n + 4, y);
    lines.forEach((l, k) => text(l, cols.desc, y - k * 11));
    text(`${i.quantity.toString()} ${i.unit}`, cols.qty, y, { right: true });
    text(fmtMoney(i.unitPrice), cols.price, y, { right: true });
    text(i.discountPct.isZero() ? "—" : fmtPct(i.discountPct), cols.disc, y, { right: true });
    text(fmtMoney(i.subtotal.sub(i.discount)), cols.amt - 4, y, { right: true });
    y -= lines.length * 11 + 6;
    page.drawLine({ start: { x: M, y: y + 3 }, end: { x: 572, y: y + 3 }, thickness: 0.3, color: rgb(0.85, 0.87, 0.9) });
  }

  y -= 6;
  const totals: [string, string][] = [
    ["Subtotal", fmtMoney(q.subtotal)],
    ["Descuento", `-${fmtMoney(q.discountTotal)}`],
    ["IVA", fmtMoney(q.taxTotal)],
    [`Total ${q.currency}`, fmtMoney(q.total)],
  ];
  totals.forEach(([k, v], idx) => {
    const last = idx === totals.length - 1;
    text(k, 470, y, { f: last ? bold : font, right: true, size: last ? 11 : 9 });
    text(v, 568, y, { f: last ? bold : font, right: true, size: last ? 11 : 9 });
    y -= last ? 16 : 13;
  });

  if (q.notes) {
    y -= 8;
    text("Notas y condiciones", M, y, { f: bold });
    y -= 12;
    for (const l of q.notes.split("\n").flatMap((p) => wrap(p, font, 9, 532))) {
      text(l, M, y);
      y -= 11;
    }
  }

  pdf.getPages().forEach((p, idx, all) => {
    p.drawText(safe(`MAC Compresores · Precios sujetos a vigencia y disponibilidad · Página ${idx + 1} de ${all.length}`), {
      x: M, y: 24, size: 7, font, color: SOFT,
    });
  });
  return pdf.save();
}
