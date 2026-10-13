import { NextResponse, type NextRequest } from "next/server";

// Corre en el runtime edge: sin prisma ni módulos de servidor. Decide por ruta (sin subdominio, sin reescrituras).

const PORTAL = "/socios";

// Rutas públicas del resto de la app (equivalen al matcher anterior, que excluía estos prefijos) + robots.txt.
const INTERNAL_PUBLIC =
  /^\/(login|recuperar|restablecer|invitacion|api\/cron|api\/compartir|manifest\.webmanifest|icon|apple-icon|_next\/static|_next\/image|brand|email-branding|favicon\.ico|robots\.txt)/;

/** Cookie del socio (`__Secure-` con Path=/socios; `mac_partner` si COOKIE_SECURE=false). Solo presencia: la validación real es del servidor. */
const PARTNER_COOKIES = ["__Secure-mac_partner", "mac_partner"];

function isPortalPath(p: string): boolean {
  return p === PORTAL || p.startsWith(`${PORTAL}/`);
}

function isAuthPage(p: string): boolean {
  return p === `${PORTAL}/login` || p.startsWith(`${PORTAL}/login/`) || p === `${PORTAL}/2fa` || p.startsWith(`${PORTAL}/2fa/`);
}

function portalCsp(): string {
  // 'unsafe-inline' en script: Next inyecta los scripts de hidratación en línea y el layout raíz aplica el tema con uno.
  // En desarrollo React necesita eval para la pila de depuración.
  const dev = process.env.NODE_ENV !== "production";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

function hardened<T extends Response>(res: T): T {
  res.headers.set("Content-Security-Policy", portalCsp());
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Cache-Control", "no-store, max-age=0");
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}

function portalMiddleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!isAuthPage(pathname) && !PARTNER_COOKIES.some((c) => req.cookies.has(c))) {
    // Una imagen sin sesión no debe redirigir a HTML: 404 sin detalle.
    if (pathname.startsWith(`${PORTAL}/p/`)) return hardened(new NextResponse(null, { status: 404 }));
    const url = req.nextUrl.clone();
    url.pathname = `${PORTAL}/login`;
    url.search = "";
    return hardened(NextResponse.redirect(url));
  }
  return hardened(NextResponse.next());
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPortalPath(pathname)) return portalMiddleware(req);
  if (INTERNAL_PUBLIC.test(pathname)) return NextResponse.next();
  // Filtro barato de presencia de cookie; la validación real ocurre en el servidor (getCurrentUser).
  if (!req.cookies.has("mac_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

// Se evalúa todo salvo los estáticos con hash; el filtrado fino vive en la función.
export const config = {
  matcher: ["/((?!_next/static).*)"],
};
