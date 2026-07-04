/** Lien d'administration (source unique header AppNav + sidebar /administration). */
export type AdminNavLink = { href: string; label: string };

export type AdminNavGroup = {
  id: string;
  label: string;
  links: readonly AdminNavLink[];
};

/** Navigation administration regroupée par intention utilisateur. */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "pilotage",
    label: "Pilotage",
    links: [
      { href: "/administration/dashboard", label: "Santé système" },
      { href: "/administration/integrations", label: "Intégrations & clés" },
      { href: "/administration/recommandations", label: "Recommandations" },
      { href: "/administration/budget", label: "Budget & coûts" },
      { href: "/administration/reprise", label: "Audit reprise" },
    ],
  },
  {
    id: "equipe",
    label: "Équipe & contenu",
    links: [
      { href: "/administration/agents", label: "Agents métiers" },
      { href: "/administration/playbooks", label: "Playbooks" },
      { href: "/administration/templates", label: "Templates missions" },
    ],
  },
  {
    id: "moteur",
    label: "Moteur IA",
    links: [
      { href: "/administration/orchestration", label: "Orchestration CIO" },
      { href: "/administration/comportements", label: "Comportements" },
      { href: "/administration/memory", label: "Mémoire entreprise" },
    ],
  },
  {
    id: "flux",
    label: "Flux & validation",
    links: [
      { href: "/administration/autonomie", label: "Tâches autonomes" },
      { href: "/administration/approbations", label: "Approbations" },
      { href: "/administration/historique", label: "Historique" },
    ],
  },
] as const;

/** Liste plate (compatibilité AppNav, tests, liens profonds). */
export const ADMIN_NAV_LINKS: readonly AdminNavLink[] = ADMIN_NAV_GROUPS.flatMap((g) => [...g.links]);

export function isAdminLinkActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/administration/dashboard" && pathname === "/administration")
  );
}
