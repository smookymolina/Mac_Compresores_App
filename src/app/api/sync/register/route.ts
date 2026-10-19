import { clientIp } from "@/lib/request";
import { assertProtocol, readJson, syncHandler } from "@/modules/sync/http";
import { registerDevice } from "@/modules/sync/register";

export const dynamic = "force-dynamic";

export const POST = syncHandler(async (req) => {
  assertProtocol(req);
  return registerDevice(await readJson(req), clientIp(req.headers));
});
