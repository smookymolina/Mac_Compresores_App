import { authenticateDevice } from "@/modules/sync/device";
import { readJson, syncHandler } from "@/modules/sync/http";
import { reserveFolios } from "@/modules/sync/folios";

export const dynamic = "force-dynamic";

export const POST = syncHandler(async (req) => {
  const { device } = await authenticateDevice(req);
  return reserveFolios(device, await readJson(req));
});
