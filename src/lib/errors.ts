import { ZodError } from "zod";

/** Error de dominio con mensaje seguro para mostrar al usuario. */
export class AppError extends Error {
  constructor(
    message: string,
    public code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "VALIDATION" | "UNAUTHENTICATED" = "VALIDATION",
  ) {
    super(message);
  }
}

export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

/** Envuelve una server action: traduce errores conocidos y oculta los internos. */
export async function runAction<T>(fn: () => Promise<T>, okMessage?: string): Promise<ActionResult<T>> {
  try {
    const data = await fn();
    return { ok: true, data, message: okMessage };
  } catch (e) {
    if (isRedirect(e)) throw e;
    if (e instanceof AppError) return { ok: false, error: e.message };
    if (e instanceof ZodError) {
      return {
        ok: false,
        error: "Revisa los datos capturados.",
        fieldErrors: e.flatten().fieldErrors as Record<string, string[]>,
      };
    }
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "P2002") {
      return { ok: false, error: "Ya existe un registro con esos datos únicos." };
    }
    console.error("[action]", e instanceof Error ? e.message : "error desconocido");
    return { ok: false, error: "Ocurrió un error inesperado." };
  }
}

function isRedirect(e: unknown) {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}
