/** Lien d'administration (sidebar /administration ; tiroir mobile via AppNav). */
export type AdminNavLink = {
  href: string;
  label: string;
  /** Cœur du moteur : visible seulement pour le propriétaire d'instance (profil Élude). */
  operatorOnly?: boolean;
};

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
      { href: "/administration/agents", label: "Fiches agents", operatorOnly: true },
    ],
  },
  {
    id: "pilotage",
    label: "Pilotage",
    links: [
      { href: "/administration/dashboard", label: "Santé système", operatorOnly: true },
      { href: "/administration/integrations", label: "Intégrations" },
      { href: "/administration/recommandations", label: "Recommandations", operatorOnly: true },
      { href: "/administration/budget", label: "Budget & coûts", operatorOnly: true },
      { href: "/administration/reprise", label: "Audit reprise", operatorOnly: true },
    ],
  },
  {
    id: "presence",
    label: "Présence & modèles",
    links: [
      { href: "/administration/vitrine", label: "Page publique" },
      { href: "/administration/templates", label: "Templates missions", operatorOnly: true },
    ],
  },
  {
    id: "moteur",
    label: "Moteur IA",
    links: [
      { href: "/administration/orchestration", label: "Prompts d’orchestration", operatorOnly: true },
      { href: "/administration/comportements", label: "Comportements", operatorOnly: true },
      { href: "/administration/memory", label: "Votre activité" },
      { href: "/administration/contexte", label: "Science de l'entreprise" },
    ],
  },
  {
    id: "flux",
    label: "Flux & validation",
    links: [
      { href: "/administration/autonomie", label: "Tâches autonomes", operatorOnly: true },
      { href: "/administration/approbations", label: "Approbations", operatorOnly: true },
      { href: "/administration/historique", label: "Historique", operatorOnly: true },
    ],
  },
] as const;

/** Liens visibles en mode Essentiel. Les autres pages d'administration sont fermées. */
export const ESSENTIAL_ADMIN_HREFS = new Set([
  "/administration/memory",
  "/administration/contexte",
  "/administration/vitrine",
  "/administration/modeles",
  "/administration/integrations",
  "/administration/equipes",
]);

/** Entrée Administration quand le tableau de santé système est masqué. */
export const ESSENTIAL_ADMIN_ENTRY = "/administration/memory";

/** Pages du moteur et de l'instance. Un admin d'espace client ne les ouvre pas. */
export const OPERATOR_ADMIN_PREFIXES = [
  "/administration/dashboard",
  "/administration/recommandations",
  "/administration/budget",
  "/administration/reprise",
  "/administration/templates",
  "/administration/orchestration",
  "/administration/comportements",
  "/administration/autonomie",
  "/administration/approbations",
  "/administration/historique",
  "/administration/agents",
  "/administration/agent-groups",
  "/administration/portefeuille",
  "/administration/enveloppes",
  "/configuration",
] as const;

export function isOperatorAdminPath(pathname: string): boolean {
  const path = (pathname || "/").split("?")[0]?.split("#")[0] || "/";
  const normalized = path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  if (normalized === "/administration") return true;
  return OPERATOR_ADMIN_PREFIXES.some(
    (href) => normalized === href || normalized.startsWith(`${href}/`),
  );
}

export function filterAdminNavGroups(
  groups: readonly AdminNavGroup[],
  opts: { essential: boolean; platformOwner?: boolean },
): AdminNavGroup[] {
  return groups
    .map((g) => ({
      ...g,
      links: g.links.filter((l) => {
        if (l.operatorOnly) return Boolean(opts.platformOwner);
        if (opts.essential) return ESSENTIAL_ADMIN_HREFS.has(l.href);
        return true;
      }),
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
