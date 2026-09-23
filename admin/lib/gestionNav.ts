/** Navigation Gestion entreprise — source unique (header, sidebar, Ctrl+K). */

export type GestionNavGroupId = "creation" | "equipes" | "activite";

export type GestionNavLink = {
  href: string;
  label: string;
  hint: string;
  icon: string;
  group: GestionNavGroupId;
  /** true = correspondance exacte du pathname (hub /gestion). */
  exact?: boolean;
};

export type GestionQuickAction = {
  id: string;
  href: string;
  label: string;
  hint: string;
};

export const GESTION_HUB_HREF = "/gestion";

export const GESTION_NAV_GROUP_LABELS: Record<GestionNavGroupId, string> = {
  creation: "Création",
  equipes: "Équipes projet",
  activite: "Activité",
};

export const GESTION_NAV_LINKS: readonly GestionNavLink[] = [
  {
    href: GESTION_HUB_HREF,
    label: "Vue d'ensemble",
    hint: "Tableau de bord entreprise",
    icon: "📊",
    group: "activite",
    exact: true,
  },
  {
    href: "/carte",
    label: "Carte",
    hint: "Graphe équipes · missions · projets",
    icon: "🗺️",
    group: "equipes",
  },
  {
    href: "/gestion/studio",
    label: "Studio",
    hint: "Articles, PDF, podcasts, vidéo, réseaux",
    icon: "✍️",
    group: "creation",
  },
  {
    href: "/gestion/playbooks",
    label: "Playbooks",
    hint: "Scénarios prêts à lancer",
    icon: "📋",
    group: "creation",
  },
  {
    href: "/gestion/livrables",
    label: "Livrables",
    hint: "Bibliothèque des pièces produites",
    icon: "📦",
    group: "creation",
  },
  {
    href: "/gestion/equipes",
    label: "Équipes projet",
    hint: "Contextes de travail avec les autres groupes",
    icon: "🤝",
    group: "equipes",
  },
  {
    href: "/gestion/contacts",
    label: "Contacts",
    hint: "Prospects, clients, partenaires",
    icon: "👤",
    group: "activite",
  },
  {
    href: "/gestion/courrier",
    label: "Courrier",
    hint: "Réponses, en attente, brouillons",
    icon: "✉️",
    group: "activite",
  },
  {
    href: "/gestion/projets",
    label: "Projets",
    hint: "Séances, stages, modules pro",
    icon: "📁",
    group: "activite",
  },
  {
    href: "/gestion/planning",
    label: "Planning",
    hint: "Rendez-vous et documents à partager",
    icon: "📅",
    group: "activite",
  },
  {
    href: "/gestion/devis",
    label: "Devis",
    hint: "Commercial · facture via Tiime",
    icon: "📝",
    group: "activite",
  },
] as const;

export const GESTION_QUICK_ACTIONS: readonly GestionQuickAction[] = [
  { id: "studio", href: "/gestion/studio", label: "Produire un contenu", hint: "Ouvrir le studio" },
  { id: "new-resource", href: "/gestion/planning/nouveau?resource=1", label: "Ajouter un document", hint: "PDF, vidéo, podcast" },
  { id: "new-contact", href: "/gestion/contacts/nouveau", label: "Nouveau contact", hint: "Créer un contact" },
  { id: "new-event", href: "/gestion/planning/nouveau", label: "Planifier un rendez-vous", hint: "Ajouter au planning" },
  { id: "new-quote", href: "/gestion/devis/nouveau", label: "Nouveau devis", hint: "Créer un devis" },
] as const;

export function isGestionPath(pathname: string): boolean {
  return pathname === GESTION_HUB_HREF || pathname.startsWith(`${GESTION_HUB_HREF}/`);
}

export function isGestionLinkActive(pathname: string, link: GestionNavLink): boolean {
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}

/** Liens Gestion en mode Essentiel. */
const ESSENTIAL_GESTION_HREFS = new Set([
  GESTION_HUB_HREF,
  "/gestion/playbooks",
  "/gestion/livrables",
  "/gestion/contacts",
  "/gestion/courrier",
  "/gestion/planning",
  "/gestion/devis",
]);

const ESSENTIAL_LABEL_OVERRIDES: Record<string, string> = {
  "/gestion/livrables": "Documents",
};

export function filterGestionNavLinks(
  links: readonly GestionNavLink[],
  opts: { essential: boolean },
): GestionNavLink[] {
  const base = opts.essential ? links.filter((l) => ESSENTIAL_GESTION_HREFS.has(l.href)) : [...links];
  return base.map((l) => {
    const override = opts.essential ? ESSENTIAL_LABEL_OVERRIDES[l.href] : undefined;
    return override ? { ...l, label: override } : l;
  });
}

export function groupedGestionNavLinks(essential = false): {
  id: GestionNavGroupId;
  label: string;
  links: GestionNavLink[];
}[] {
  const filtered = filterGestionNavLinks(GESTION_NAV_LINKS, { essential });
  const order: GestionNavGroupId[] = essential
    ? ["creation", "activite"]
    : ["creation", "equipes", "activite"];
  return order.map((id) => ({
    id,
    label: GESTION_NAV_GROUP_LABELS[id],
    links: filtered.filter((link) => link.group === id && !link.exact) as GestionNavLink[],
  })).filter((g) => g.links.length > 0);
}

export function gestionNavGroupHeadingClass(id: GestionNavGroupId): string {
  if (id === "creation") return "text-violet-700";
  if (id === "equipes") return "text-sky-700";
  return "text-emerald-700";
}

export function gestionNavGroupCompactClass(id: GestionNavGroupId): string {
  if (id === "creation") return "text-violet-500";
  if (id === "equipes") return "text-sky-500";
  return "text-emerald-500";
}

export function gestionNavGroupCardBorderClass(id: GestionNavGroupId): string {
  if (id === "creation") return "border-violet-100 hover:border-violet-300";
  if (id === "equipes") return "border-sky-100 hover:border-sky-300";
  return "border-emerald-100 hover:border-emerald-300";
}

export function gestionNavGroupTitleHoverClass(id: GestionNavGroupId): string {
  if (id === "creation") return "group-hover:text-violet-900";
  if (id === "equipes") return "group-hover:text-sky-900";
  return "group-hover:text-emerald-900";
}
