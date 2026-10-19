import { z } from "zod";
import { authenticateDevice } from "@/modules/sync/device";
import { readJson, syncHandler } from "@/modules/sync/http";
import { requestAppDownload } from "@/modules/sync/app-download";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ platform: z.enum(["android", "ios"]).default("android") });

export const POST = syncHandler(async (req) => {
  const { device } = await authenticateDevice(req);
  const { platform } = bodySchema.parse(await readJson(req));
  return requestAppDownload(device, platform);
});
