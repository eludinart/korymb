import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { KORYMB_TOKEN_COOKIE } from "./lib/authSession";

const PUBLIC_PREFIXES = ["/login", "/register", "/api/auth", "/api/public", "/confidentialite", "/cgu", "/p"];

function isPublicRoute(pathname: string) {
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

function participantLoginFromPath(pathname: string) {
  const match = pathname.match(/^\/a\/([^/]+)/);
  if (!match) return null;
  return `/p/${match[1]}/connexion`;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicRoute(pathname)) {
    return NextResponse.next();
  }
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim();
  if (!token) {
    const participant = participantLoginFromPath(pathname);
    const login = new URL(participant || "/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
