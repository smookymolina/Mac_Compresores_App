import { revalidatePath } from "next/cache";
import { authenticateDevice } from "@/modules/sync/device";
import { readJson, syncHandler } from "@/modules/sync/http";
import { pushRequestSchema } from "@/modules/sync/protocol";
import { push } from "@/modules/sync/push";

export const dynamic = "force-dynamic";

/** Recibe el outbox del teléfono: `{ commands: [...] }` → `{ results: [{ id, status, result?, error? }] }`. */
export const POST = syncHandler(async (req) => {
  const { device, user } = await authenticateDevice(req);
  const { commands } = pushRequestSchema.parse(await readJson(req));
  const results = await push(user, device, commands);
  if (results.some((r) => r.status === "APPLIED")) {
    for (const p of ["/cotizaciones", "/clientes", "/ventas", "/cobranza"]) revalidatePath(p);
  }
  return { results };
});
