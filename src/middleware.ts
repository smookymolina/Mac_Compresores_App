import { NextResponse, type NextRequest } from "next/server";

// Filtro barato de presencia de cookie; la validación real ocurre en el servidor (getCurrentUser).
export function middleware(req: NextRequest) {
  if (!req.cookies.has("mac_session")) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!login|recuperar|restablecer|_next/static|_next/image|brand|favicon.ico).*)"],
};
