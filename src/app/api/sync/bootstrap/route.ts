import { authenticateDevice } from "@/modules/sync/device";
import { syncHandler } from "@/modules/sync/http";
import { bootstrapPage } from "@/modules/sync/pull";
import { currentServerSeq } from "@/modules/sync/register";

export const dynamic = "force-dynamic";

/** Página de la descarga inicial; la primera página (sin `after`) trae `serverSeq` para empezar el pull. */
export const GET = syncHandler(async (req) => {
  const { user } = await authenticateDevice(req);
  const url = new URL(req.url);
  const after = url.searchParams.get("after") || undefined;
  const limit = Number(url.searchParams.get("limit") ?? 1000) || 1000;
  // El seq se captura antes de leer: lo que cambie durante la descarga vuelve a llegar por pull.
  const serverSeq = after ? undefined : await currentServerSeq();
  const page = await bootstrapPage(user, url.searchParams.get("entity") ?? "", after, limit);
  return { ...page, ...(serverSeq !== undefined && { serverSeq }) };
});
