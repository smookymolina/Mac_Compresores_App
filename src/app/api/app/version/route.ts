import { syncHandler } from "@/modules/sync/http";
import { mobileAppVersion } from "@/modules/sync/version";

export const dynamic = "force-dynamic";

/** Público: versión vigente y mínima de la app móvil. */
export const GET = syncHandler(async () => mobileAppVersion());
