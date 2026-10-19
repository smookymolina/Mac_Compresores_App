import { iosManifestResponse } from "@/modules/sync/app-download";

export const dynamic = "force-dynamic";

/** Público en el middleware: solo token firmado de iOS (el instalador de iOS no manda cookies). */
export const GET = (req: Request) => iosManifestResponse(req);
