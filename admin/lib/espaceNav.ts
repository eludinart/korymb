/** Navigation de l’espace participant — source unique (header `/a/{slug}`). */

export type EspaceNavLink = {
  id: string;
  label: string;
  suffix: string;
  exact?: boolean;
};

export const ESPACE_NAV_LINKS: readonly EspaceNavLink[] = [
  { id: "accueil", label: "Accueil", suffix: "", exact: true },
  { id: "seances", label: "Calendrier", suffix: "/seances" },
  { id: "ressources", label: "Mes ressources", suffix: "/ressources" },
  { id: "compte", label: "Mon compte", suffix: "/compte" },
] as const;

export function espaceHref(slug: string, suffix = "") {
  return `/a/${encodeURIComponent(slug)}${suffix}`;
}

export function isEspaceLinkActive(pathname: string, slug: string, link: EspaceNavLink) {
  const href = espaceHref(slug, link.suffix);
  if (link.exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
