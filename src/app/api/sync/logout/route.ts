import { authenticateDevice } from "@/modules/sync/device";
import { syncHandler } from "@/modules/sync/http";
import { logoutDevice } from "@/modules/sync/register";

export const dynamic = "force-dynamic";

export const POST = syncHandler(async (req) => {
  const { device } = await authenticateDevice(req);
  await logoutDevice(device);
  return { ok: true };
});
