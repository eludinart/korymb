import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { KORYMB_TOKEN_COOKIE } from "./lib/authSession";

/** `/api/korymb*` reste joignable sans cookie pour les chemins publics (vitrine).
 *  Le proxy refuse ensuite toute route métier sans session — il n'attache pas le secret agent. */
const PUBLIC_PREFIXES = [
  "/login",
  "/register",
  "/api/auth",
  "/api/public",
  "/api/korymb",
  "/api/korymb-bin",
  "/api/korymb-events",
  "/api/korymb-admin",
  "/confidentialite",
  "/cgu",
  "/p",
];

/** Assets PWA / icônes : publics (sinon Chrome reçoit du HTML login → « Manifest syntax error »). */
const PUBLIC_EXACT = new Set([
  "/ouvrir",
  "/manifest.json",
  "/sw.js",
  "/favicon.ico",
  "/icon.svg",
  "/apple-touch-icon.png",
  "/icon-16.png",
  "/icon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-192-maskable.png",
  "/icon-512-maskable.png",
]);

function isPublicRoute(pathname: string) {
  if (pathname === "/") return true;
  if (PUBLIC_EXACT.has(pathname)) return true;
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
  /* /briefing est le start_url historique de l'icône. Sans cookie, la page
   * répond 200 (écran d'ouverture) au lieu d'une 307 qui fige le splash. */
  if (pathname === "/briefing") {
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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|sw.js|icon\\.svg|apple-touch-icon\\.png|icon-.*\\.png).*)",
  ],
};
