import "server-only";
import { headers } from "next/headers";
import { clientIp } from "@/lib/request";
import { logPartnerActivity } from "./activity";
import { autoBlock } from "./guard";
import { getCurrentPartner } from "./session";

/** Enlace trampa: nadie legítimo llega aquí. Con sesión de socio => HONEYPOT + bloqueo. Siempre 404 sin detalle. */
export async function honeypotResponse(): Promise<Response> {
  try {
    const current = await getCurrentPartner();
    if (current && current.partner.status === "ACTIVE") {
      const h = await headers();
      await logPartnerActivity({ partnerId: current.partner.id, type: "HONEYPOT", ip: clientIp(h), userAgent: h.get("user-agent") });
      await autoBlock(current.partner.id, "HONEYPOT");
    }
  } catch (e) {
    console.error("[partners] honeypot", e instanceof Error ? e.message : e);
  }
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}
