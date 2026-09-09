import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { KORYMB_TOKEN_COOKIE } from "./lib/authSession";

const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth"];

function isPublicRoute(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim();
  // Session utilisateur uniquement. Le secret agent (KORYMB_AGENT_SECRET) sert au
  // proxy serveur → FastAPI, pas à contourner le login navigateur.
  if (!token) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
