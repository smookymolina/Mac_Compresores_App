import { authenticateDevice } from "@/modules/sync/device";
import { syncHandler } from "@/modules/sync/http";
import { parseCursor, pull } from "@/modules/sync/pull";

export const dynamic = "force-dynamic";

export const GET = syncHandler(async (req) => {
  const { device, user } = await authenticateDevice(req);
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") ?? 500) || 500;
  return pull(user, device, parseCursor(url.searchParams.get("cursor")), limit);
});
