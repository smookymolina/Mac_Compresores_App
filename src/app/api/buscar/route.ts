import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { globalSearch } from "@/modules/search/service";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return NextResponse.json({ hits: await globalSearch(user, q) }, { headers: { "Cache-Control": "private, no-store" } });
}
