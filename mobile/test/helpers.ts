import { vi } from "vitest";

type Handler = (url: URL, init: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;

/** fetch simulado: enruta por pathname y registra las llamadas. */
export function mockFetch(routes: Record<string, Handler>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    const h = routes[url.pathname];
    if (!h) return new Response(JSON.stringify({ error: "no route" }), { status: 404 });
    const { status = 200, body } = await h(url, init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
