/** Lien d'administration (source unique header AppNav + sidebar /administration). */
export type AdminNavLink = { href: string; label: string };

export type AdminNavGroup = {
  id: string;
  label: string;
  /** Mise en avant visuelle (ex. gestion des agents). */
  emphasis?: "agents";
  links: readonly AdminNavLink[];
};

/** Navigation administration regroupée par intention utilisateur. */
export const ADMIN_NAV_GROUPS: readonly AdminNavGroup[] = [
  {
    id: "agents",
    label: "Gestion des agents",
    emphasis: "agents",
    links: [
      { href: "/administration/equipes", label: "Équipes" },
      { href: "/administration/agents", label: "Fiches agents" },
    ],
  },
  {
    id: "pilotage",
    label: "Pilotage",
    links: [
      { href: "/administration/dashboard", label: "Santé système" },
      { href: "/administration/integrations", label: "Intégrations" },
      { href: "/administration/recommandations", label: "Recommandations" },
      { href: "/administration/budget", label: "Budget & coûts" },
      { href: "/administration/reprise", label: "Audit reprise" },
    ],
  },
  {
    id: "presence",
    label: "Présence & modèles",
    links: [
      { href: "/administration/vitrine", label: "Page publique" },
      { href: "/administration/modeles", label: "Modèles de démarrage" },
      { href: "/administration/templates", label: "Templates missions" },
    ],
  },
  {
    id: "moteur",
    label: "Moteur IA",
    links: [
      { href: "/administration/orchestration", label: "Prompts d’orchestration" },
      { href: "/administration/comportements", label: "Comportements" },
      { href: "/administration/memory", label: "Mémoire partagée" },
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

/** Liens visibles en mode Essentiel (le reste reste accessible via URL / mode Avancé). */
const ESSENTIAL_ADMIN_HREFS = new Set([
  "/administration/memory",
  "/administration/vitrine",
  "/administration/modeles",
  "/administration/integrations",
  "/administration/equipes",
]);

export function filterAdminNavGroups(
  groups: readonly AdminNavGroup[],
  opts: { essential: boolean },
): AdminNavGroup[] {
  if (!opts.essential) return groups.map((g) => ({ ...g, links: [...g.links] }));
  return groups
    .map((g) => ({
      ...g,
      links: g.links.filter((l) => ESSENTIAL_ADMIN_HREFS.has(l.href)),
    }))
    .filter((g) => g.links.length > 0);
}

/** Pages du périmètre « gestion des agents » (sous-nav dédiée). */
export function isAgentsAdminPath(pathname: string): boolean {
  return (
    pathname === "/administration/equipes" ||
    pathname.startsWith("/administration/equipes/") ||
    pathname === "/administration/agents" ||
    pathname.startsWith("/administration/agents/") ||
    pathname === "/administration/agent-groups" ||
    pathname.startsWith("/administration/agent-groups/")
  );
}

export function isAdminLinkActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/administration/dashboard" && pathname === "/administration")
  );
}
