import { ESSENTIAL_ADMIN_ENTRY, ESSENTIAL_ADMIN_HREFS } from "./adminNav";
import { DIRECTOR_QUEUE_HREF } from "./directorQueue";
import { ESSENTIAL_GESTION_HREFS, GESTION_HUB_HREF } from "./gestionNav";

const ACCOUNT_PREFIXES = [
  "/briefing",
  "/chat",
  "/profil",
  "/aide",
  "/espace",
  DIRECTOR_QUEUE_HREF,
] as const;

function pathOnly(pathname: string): string {
  const raw = (pathname || "/").split("?")[0]?.split("#")[0] || "/";
  if (raw.length > 1 && raw.endsWith("/")) return raw.slice(0, -1);
  return raw || "/";
}

function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Pages ouvrables en mode Essentiel. Toute autre adresse renvoie à la conversation. */
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

/**
 * Remappe une URL affichée (notif, CTA, lien) vers une surface ouverte
 * pour le mode / rôle courant — évite les badges orphelins.
 */
export function safeSurfaceHref(
  href: string,
  opts: { essential: boolean; platformOwner?: boolean },
): string {
  const raw = String(href || "").trim();
  if (!raw) return "/chat";
  if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("mailto:") || raw.startsWith("tel:")) {
    return raw;
  }
  const path = pathOnly(raw);
  const qs = raw.includes("?") ? raw.slice(raw.indexOf("?")) : "";
  const hash = raw.includes("#") ? raw.slice(raw.indexOf("#")) : "";

  if (!opts.essential) {
    if (
      !opts.platformOwner &&
      (path.startsWith("/administration/approbations") ||
        path.startsWith("/administration/budget") ||
        path.startsWith("/administration/dashboard") ||
        path.startsWith("/administration/historique") ||
        path.startsWith("/configuration") ||
        path === "/historique")
    ) {
      return DIRECTOR_QUEUE_HREF;
    }
    return raw.startsWith("/") ? raw : `/${raw}`;
  }

  if (isEssentialAllowedPath(path)) {
    return `${path}${qs}${hash}`;
  }
  if (path.startsWith("/missions") || path.startsWith("/administration/approbations") || path === "/historique") {
    return DIRECTOR_QUEUE_HREF;
  }
  if (
    path.startsWith("/gestion/studio") ||
    path.startsWith("/gestion/livrables") ||
    path.startsWith("/gestion/projets") ||
    path.startsWith("/gestion/equipes") ||
    path === "/livrables"
  ) {
    return GESTION_HUB_HREF;
  }
  if (path.startsWith("/administration")) {
    return ESSENTIAL_ADMIN_ENTRY;
  }
  if (path === "/dashboard" || path === "/carte" || path === "/configuration") {
    return "/chat";
  }
  return "/chat";
}
