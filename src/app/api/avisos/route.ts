import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth/session";
import { listNotifications, markRead } from "@/modules/notifications/service";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json(await listNotifications(user.id), { headers: NO_STORE });
}

/** Marca como leído un aviso ({ id }) o todos ({}). Solo los del propio usuario. */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const body = z.object({ id: z.string().uuid().optional() }).safeParse(await req.json().catch(() => ({})));
  if (!body.success) return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  await markRead(user.id, body.data.id);
  return NextResponse.json(await listNotifications(user.id), { headers: NO_STORE });
}
