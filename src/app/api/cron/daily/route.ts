import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runDailyJob } from "@/modules/jobs/daily";

// Lo llama el servicio «scheduler» (docker-compose) con Authorization: Bearer $CRON_SECRET.
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function POST(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try {
    return NextResponse.json(await runDailyJob());
  } catch (e) {
    console.error("[cron] trabajo diario:", e instanceof Error ? e.message : e);
    return NextResponse.json({ error: "Error en el trabajo diario" }, { status: 500 });
  }
}
