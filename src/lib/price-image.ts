import "server-only";
import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";

/**
 * Precio como PNG. Los glifos se dibujan como <path> propios (fuente de trazos), nunca con <text>:
 * así no hacen falta fuentes en la imagen del contenedor y el monto no existe como texto en ningún paso.
 * La marca del socio va como patrón de puntos codificado (ver `watermarkBits`) más ruido leve.
 */

// Cada glifo vive en una rejilla de 6 x 10 (y hacia abajo). Una cadena = un trazo continuo.
const GLYPHS: Record<string, string[]> = {
  "0": ["M1,0L5,0L6,1L6,9L5,10L1,10L0,9L0,1Z", "M1.5,7.5L4.5,2.5"],
  "1": ["M1,2.5L3,0.5L3,10", "M1,10L5,10"],
  "2": ["M0,1L1,0L5,0L6,1L6,4L0,10L6,10"],
  "3": ["M0,0L6,0L3,4.5L5,4.5L6,5.5L6,9L5,10L1,10L0,9"],
  "4": ["M5,10L5,0L0,7L6,7"],
  "5": ["M6,0L0,0L0,5L5,5L6,6L6,9L5,10L1,10L0,9"],
  "6": ["M6,1L5,0L1,0L0,1L0,9L1,10L5,10L6,9L6,6L5,5L0,5"],
  "7": ["M0,0L6,0L2,10"],
  "8": ["M1,0L5,0L6,1L6,4L5,5L1,5L0,4L0,1Z", "M1,5L5,5L6,6L6,9L5,10L1,10L0,9L0,6Z"],
  "9": ["M0,9L1,10L5,10L6,9L6,1L5,0L1,0L0,1L0,4L1,5L6,5"],
  "$": ["M6,2L5,1L1,1L0,2L0,4L1,5L5,5L6,6L6,8L5,9L1,9L0,8", "M3,-1L3,11"],
  ",": ["M1.6,9L0.6,12"],
  ".": ["M1.6,10L1.6,10.01"],
  "-": ["M0,5L6,5"],
  "%": ["M0,10L6,0", "M0.5,0.5L2,0.5L2,2.5L0.5,2.5Z", "M4,7.5L5.5,7.5L5.5,9.5L4,9.5Z"],
  U: ["M0,0L0,9L1,10L5,10L6,9L6,0"],
  S: ["M6,1L5,0L1,0L0,1L0,4L1,5L5,5L6,6L6,9L5,10L1,10L0,9"],
  D: ["M0,0L0,10L4,10L6,8L6,2L4,0Z"],
  M: ["M0,10L0,0L3,5L6,0L6,10"],
  X: ["M0,0L6,10", "M6,0L0,10"],
  N: ["M0,10L0,0L6,10L6,0"],
};

const W = 144; // lienzo CSS 144x32 (spec de UI); se rasteriza a 2x = 288x64
const H = 32;
const SCALE = 2;
/** Alto extra (unidades CSS) de la fila del precio normal. */
export const LIST_ROW = 18;
const ADV = 9.6; // avance horizontal por glifo (en unidades de rejilla)

/** "12345.6" -> "12,345.60"; si no es un decimal simple se deja tal cual (solo glifos conocidos). */
function formatAmount(raw: string): string {
  const m = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(raw.trim());
  if (!m) return raw.replace(/[^0-9$.,-]/g, "");
  const int = m[2]!.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${m[1]}$${int}.${(m[3] ?? "").padEnd(2, "0")}`;
}

function run(text: string, x: number, y: number, s: number, rnd: () => number, jitter: number): { d: string; width: number } {
  let d = "";
  let cx = x;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (g) {
      const jy = (rnd() - 0.5) * jitter;
      const jx = (rnd() - 0.5) * jitter;
      for (const stroke of g) {
        d += stroke.replace(/([ML])(-?[\d.]+),(-?[\d.]+)/g, (_, c: string, px: string, py: string) =>
          `${c}${(cx + jx + Number(px) * s).toFixed(2)},${(y + jy + Number(py) * s).toFixed(2)}`);
      }
    }
    cx += (ch === "," || ch === "." ? 3.8 : ADV) * s;
  }
  return { d, width: cx - x };
}

/** Bits de la marca: etiqueta de 48 bits (sha256 de la marca) repetida; se puede recomputar para atribuir una captura. */
export function watermarkBits(watermark: string): number[] {
  const h = createHash("sha256").update(`mac-wm:${watermark}`).digest();
  const bits: number[] = [];
  for (let i = 0; i < 6; i++) for (let b = 7; b >= 0; b--) bits.push((h[i]! >> b) & 1);
  return bits;
}

function prng(seed: Buffer): () => number {
  let a = seed.readUInt32LE(0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Con `list`, la imagen crece a 144x52: arriba el precio normal tachado y el % de descuento; abajo el precio del socio. */
export function buildPriceSvg(o: { amount: string; currency: string; watermark: string; list?: { amount: string; pct: string } }): string {
  const rnd = prng(randomBytes(4));
  const amountText = formatAmount(o.amount);
  const cur = o.currency.toUpperCase().replace(/[^A-Z]/g, "");

  // Escala: el monto ocupa el ancho disponible (máx. 13 de alto) y la moneda va a 0.7 de esa escala.
  const units = (t: string) => [...t].reduce((n, c) => n + (c === "," || c === "." ? 3.8 : ADV), 0);
  const avail = W - 16;
  const s = Math.min(1.3, avail / (units(amountText) + 3 + units(cur) * 0.62));
  const sc = s * 0.62;
  const top = o.list ? LIST_ROW : 0;
  const HH = H + top;
  const y = top + (H - 10 * s) / 2;
  const a = run(amountText, 8, y, s, rnd, 0.5);
  const c = run(cur, 8 + a.width + 3 * s, y + (10 * s - 10 * sc), sc, rnd, 0.3);

  // Patrón de puntos: celdas de 4x4 sobre toda la imagen; el bit i decide si la celda i lleva un punto.
  const bits = watermarkBits(o.watermark);
  let dots = "";
  const cols = W / 4;
  const rows = HH / 4;
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      if (bits[(r * 7 + k) % bits.length] === 1) {
        dots += `M${k * 4 + 2},${r * 4 + 2.4}h0.01`;
      }
    }
  }

  // Ruido leve: motas y líneas tenues aleatorias (distintas en cada render).
  let noise = "";
  for (let i = 0; i < 28; i++) noise += `M${(rnd() * W).toFixed(1)},${(rnd() * HH).toFixed(1)}h${(rnd() * 3 + 0.3).toFixed(1)}`;
  let lines = "";
  for (let i = 0; i < 3; i++) lines += `M${(rnd() * 40).toFixed(1)},${(rnd() * H).toFixed(1)}L${(rnd() * 100 + 40).toFixed(1)},${(rnd() * H).toFixed(1)}`;

  // Fila superior: precio normal tachado (gris) y descuento (verde) a la derecha.
  let listRow = "";
  if (o.list) {
    const ls = 0.62;
    const la = run(formatAmount(o.list.amount), 10, 5, ls, rnd, 0.2);
    const lc = run(cur, 10 + la.width + 3 * ls, 5, ls, rnd, 0.2);
    const l = { d: la.d + lc.d, width: la.width + 3 * ls + lc.width };
    const pctText = `-${o.list.pct.replace(/[^0-9.]/g, "")}%`;
    const pw = units(pctText) * ls;
    const pc = run(pctText, W - 10 - pw, 5, ls, rnd, 0.2);
    listRow =
      `<path d="${l.d}" stroke="#64748b" stroke-width="${(ls * 0.8).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `<path d="M8,${(5 + 5 * ls).toFixed(1)}L${(12 + l.width).toFixed(1)},${(5 + 5 * ls).toFixed(1)}" stroke="#64748b" stroke-width="0.9"/>` +
      `<path d="${pc.d}" stroke="#15803d" stroke-width="${(ls * 0.95).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * SCALE}" height="${HH * SCALE}" viewBox="0 0 ${W} ${HH}">` +
    `<rect width="${W}" height="${HH}" rx="${o.list ? 12 : H / 2}" fill="#ffffff"/>` + listRow +
    `<path d="${lines}" stroke="#0f172a" stroke-opacity="0.07" stroke-width="0.5" fill="none"/>` +
    `<path d="${noise}" stroke="#0f172a" stroke-opacity="0.16" stroke-width="0.6" stroke-linecap="round" fill="none"/>` +
    `<path d="${dots}" stroke="#0f172a" stroke-opacity="0.22" stroke-width="0.9" stroke-linecap="round" fill="none"/>` +
    `<path d="${a.d}" stroke="#0f172a" stroke-width="${(s * 0.78).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `<path d="${c.d}" stroke="#334155" stroke-width="${(sc * 0.9).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
    `</svg>`
  );
}

/** PNG de 288x64 px (144x32 CSS a 2x; 144x50 con precio normal, píldora blanca #fff con texto #0f172a, independiente del tema), sin metadatos (sharp no copia EXIF/ICC/XMP salvo `withMetadata`). */
export async function renderPriceImage(o: Parameters<typeof buildPriceSvg>[0]): Promise<Buffer> {
  return sharp(Buffer.from(buildPriceSvg(o)), { density: 72 })
    .png({ compressionLevel: 6, adaptiveFiltering: false })
    .toBuffer();
}
