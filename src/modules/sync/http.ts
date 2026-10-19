import "server-only";
import { ZodError } from "zod";
import { AppError } from "@/lib/errors";
import { SYNC_PROTOCOL } from "./device";

const STATUS: Record<AppError["code"], number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, VALIDATION: 400,
};

/** JSON con Decimal → string (vía su toJSON) y BigInt → string. */
export function jsonResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body, (_k, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
  return new Response(text, { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

/**
 * Envuelve un route handler de la app móvil: el resultado de `fn` se responde como JSON;
 * errores conocidos → código HTTP con `{ error, code }`, internos → 500 sin detalles.
 * Si `fn` devuelve un `Response`, se pasa tal cual.
 */
export function syncHandler(fn: (req: Request) => Promise<unknown>) {
  return async (req: Request): Promise<Response> => {
    try {
      const out = await fn(req);
      return out instanceof Response ? out : jsonResponse(out ?? { ok: true });
    } catch (e) {
      if (e instanceof AppError) {
        const upgrade = e.code === "CONFLICT" && req.headers.get("x-sync-protocol") !== String(SYNC_PROTOCOL);
        return jsonResponse({ error: e.message, code: e.code, ...(upgrade && { upgrade: true }) }, STATUS[e.code] ?? 400);
      }
      if (e instanceof ZodError) {
        return jsonResponse({ error: "Revisa los datos enviados.", code: "VALIDATION", fieldErrors: e.flatten().fieldErrors }, 400);
      }
      if (e instanceof SyntaxError) return jsonResponse({ error: "JSON inválido.", code: "VALIDATION" }, 400);
      console.error("[sync]", e instanceof Error ? e.message : "error desconocido");
      return jsonResponse({ error: "Ocurrió un error inesperado.", code: "INTERNAL" }, 500);
    }
  };
}

/** Cuerpo JSON de la petición (vacío → {}). */
export async function readJson(req: Request): Promise<unknown> {
  const t = await req.text();
  return t ? JSON.parse(t) : {};
}

/** Valida la cabecera `X-Sync-Protocol` (para rutas sin token, p. ej. registro). */
export function assertProtocol(req: Request) {
  if (req.headers.get("x-sync-protocol") !== String(SYNC_PROTOCOL))
    throw new AppError("Actualiza la app para seguir sincronizando.", "CONFLICT");
}
