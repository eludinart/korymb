import { ESSENTIAL_ADMIN_HREFS } from "./adminNav";
import { DIRECTOR_QUEUE_HREF } from "./directorQueue";
import { ESSENTIAL_GESTION_HREFS, GESTION_HUB_HREF } from "./gestionNav";

const ACCOUNT_PREFIXES = ["/briefing", "/chat", "/profil", DIRECTOR_QUEUE_HREF] as const;

function pathOnly(pathname: string): string {
  const raw = (pathname || "/").split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Pages ouvrables en mode Essentiel. Toute autre adresse renvoie à Aujourd'hui. */
export function isEssentialAllowedPath(pathname: string): boolean {
  const path = pathOnly(pathname);
  if (ACCOUNT_PREFIXES.some((href) => matches(path, href))) return true;
  if (path.startsWith("/a/") || path.startsWith("/p/")) return true;
  for (const href of ESSENTIAL_GESTION_HREFS) {
    if (href === GESTION_HUB_HREF) {
      if (path === GESTION_HUB_HREF) return true;
      continue;
    }
    if (matches(path, href)) return true;
  }
  for (const href of ESSENTIAL_ADMIN_HREFS) {
    if (matches(path, href)) return true;
  }
  return false;
}
