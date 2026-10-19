import { authenticateDevice } from "@/modules/sync/device";
import { syncHandler } from "@/modules/sync/http";
import { deviceConfig } from "@/modules/sync/status";

export const dynamic = "force-dynamic";

export const GET = syncHandler(async (req) => {
  const { user } = await authenticateDevice(req);
  return deviceConfig(user);
});
