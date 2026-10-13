import { hit } from "@/lib/rate-limit";
import { renderPriceImage } from "@/lib/price-image";
import { clientIp } from "@/lib/request";
import { logPartnerActivity } from "@/modules/partners/activity";
import { getCurrentPartner } from "@/modules/partners/session";
import { getPartnerPriceForProduct } from "@/modules/partners/search";
import { verifyPriceToken } from "@/modules/partners/token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BASE_HEADERS = { "Cache-Control": "no-store, max-age=0", "X-Robots-Tag": "noindex, nofollow" };
const notFound = () => new Response(null, { status: 404, headers: BASE_HEADERS });

/** PNG del precio de un producto para el socio con sesión. Cualquier fallo responde 404 sin detalle. */
export async function GET(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const claims = verifyPriceToken(token);
  if (!claims) return notFound();

  const current = await getCurrentPartner();
  if (!current) return notFound();
  const { partner, sessionId } = current;
  if (partner.status !== "ACTIVE" || partner.id !== claims.partnerId || sessionId !== claims.sessionId) return notFound();

  // Límite leve contra ráfagas de imágenes (la búsqueda ya limita por socio y por IP).
  if ((await hit(`pimg:${partner.id}`, 60_000)) > 120) {
    return new Response(null, { status: 429, headers: { ...BASE_HEADERS, "Retry-After": "30" } });
  }

  const price = await getPartnerPriceForProduct(claims.productId, partner);
  if (!price) return notFound();

  const ip = clientIp(req.headers);
  const stamp = new Date().toISOString().slice(0, 16);
  const png = await renderPriceImage({
    amount: price.price.toFixed(2),
    currency: price.currency,
    watermark: `${partner.id}|${stamp}|${ip ?? ""}`,
  });
  await logPartnerActivity({
    partnerId: partner.id,
    type: "PRICE_VIEW",
    meta: { productId: claims.productId },
    ip,
    userAgent: req.headers.get("user-agent"),
  });

  return new Response(new Uint8Array(png), {
    status: 200,
    headers: { ...BASE_HEADERS, "Content-Type": "image/png", "Content-Length": String(png.length), "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" },
  });
}
