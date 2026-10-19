import { authenticateDevice } from "@/modules/sync/device";
import { syncHandler } from "@/modules/sync/http";
import { commandStatuses } from "@/modules/sync/status";

export const dynamic = "force-dynamic";

export const GET = syncHandler(async (req) => {
  const { device } = await authenticateDevice(req);
  return commandStatuses(device, new URL(req.url).searchParams.get("ids"));
});
