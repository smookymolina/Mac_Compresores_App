import { toQuotePdfData } from "@domain/quote-pdf-data";
import { renderQuotePdf, type QuotePdfAssets } from "@domain/quote-pdf";
import type { EntityRow } from "./api";
import { isProvisional, quoteFolioLabel, type LocalQuote } from "./quotes";
import type { LocalStore } from "./store";

/** Imágenes de marca: `mobile/public/brand/*` (copiadas de `../public/brand` por `scripts/copy-brand.mjs`). */
export const BRAND_ASSETS = ["quote-header.png", "quote-footer.png", "milwaukee.jpg"] as const;
export type BrandAsset = (typeof BRAND_ASSETS)[number];
export type AssetLoader = (name: BrandAsset) => Promise<Uint8Array>;

export const fetchBrandAsset: AssetLoader = async (name) => {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? "/";
  const res = await fetch(`${base}brand/${name}`);
  if (!res.ok) throw new Error(`No se encontró la imagen ${name}.`);
  return new Uint8Array(await res.arrayBuffer());
};

const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function toBase64(u: Uint8Array): string {
  let s = "";
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

let cache: Promise<Omit<QuotePdfAssets, "sellerBlockPng">> | null = null;

/** PDF de una cotización local (mismo mapeo y renderizador que la web). */
export async function quotePdf(store: LocalStore, quoteId: string, o: { loadAsset?: AssetLoader } = {}): Promise<Uint8Array> {
  const q = await store.get<LocalQuote>("Quote", quoteId);
  if (!q) throw new Error("Cotización no encontrada.");
  const [cfg, customer] = await Promise.all([store.getMeta("config"), store.get<EntityRow & { contacts?: { name?: string }[] }>("Customer", q.customerId)]);
  const load = o.loadAsset ?? fetchBrandAsset;
  const brand = o.loadAsset
    ? loadBrand(load)
    : (cache ??= loadBrand(load).catch((e) => { cache = null; throw e; }));
  const provisional = isProvisional(q);
  const data = toQuotePdfData(q, {
    bankInfo: cfg?.bankInfo ?? [],
    customer: {
      legalName: String(customer?.legalName ?? q.customerName ?? "—"),
      rfc: (customer?.rfc as string | null | undefined) ?? null,
      contactName: customer?.contacts?.[0]?.name ?? null,
    },
    ...(provisional && { folioLabel: quoteFolioLabel(q), provisional: true }),
  });
  return renderQuotePdf(data, { ...(await brand), sellerBlockPng: cfg?.sellerBlockPng ? fromB64(cfg.sellerBlockPng) : null });
}

async function loadBrand(load: AssetLoader) {
  const [headerPng, footerPng, milwaukeeJpg] = await Promise.all(BRAND_ASSETS.map(load));
  return { headerPng: headerPng!, footerPng: footerPng!, milwaukeeJpg: milwaukeeJpg! };
}

/** Guarda el PDF en caché (`@capacitor/filesystem`) y abre la hoja de compartir (`@capacitor/share`). */
export async function shareQuotePdf(store: LocalStore, quoteId: string, o: { loadAsset?: AssetLoader } = {}): Promise<{ uri: string }> {
  const bytes = await quotePdf(store, quoteId, o);
  const q = (await store.get<LocalQuote>("Quote", quoteId))!;
  const label = quoteFolioLabel(q);
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
  const { uri } = await Filesystem.writeFile({ path: `Cotizacion-${label}.pdf`, data: toBase64(bytes), directory: Directory.Cache });
  await Share.share({ title: `Cotización ${label}`, text: `Cotización ${label} — MAC Compresores`, url: uri, dialogTitle: "Compartir cotización" });
  return { uri };
}
