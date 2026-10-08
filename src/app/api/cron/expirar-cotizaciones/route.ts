import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { expireOverdueQuotes } from "@/modules/quotes/service";

/** Tarea programada (cron externo): Authorization: Bearer $CRON_SECRET. Sin CRON_SECRET el endpoint queda deshabilitado. */
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret ?? "");
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }
  return NextResponse.json({ expired: await expireOverdueQuotes() });
}
