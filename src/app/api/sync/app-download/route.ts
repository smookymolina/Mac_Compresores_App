import { authenticateDevice } from "@/modules/sync/device";
import { syncHandler } from "@/modules/sync/http";
import { requestAppDownload } from "@/modules/sync/app-download";

export const dynamic = "force-dynamic";

export const POST = syncHandler(async (req) => {
  const { device } = await authenticateDevice(req);
  return requestAppDownload(device);
});
