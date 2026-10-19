import { getCurrentUser } from "@/lib/auth/session";
import { androidDownloadResponse } from "@/modules/sync/app-download";

export const dynamic = "force-dynamic";

/** `/api/app/*` es público en el middleware: la autorización (token firmado o sesión con acceso móvil) se valida aquí. */
export const GET = (req: Request) => androidDownloadResponse(req, async () => (await getCurrentUser())?.id ?? null);
