/** Navigation Gestion entreprise — source unique (header, sidebar, Ctrl+K). */

export type GestionNavGroupId = "creation" | "activite";

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

export function groupedGestionNavLinks(): { id: GestionNavGroupId; label: string; links: GestionNavLink[] }[] {
  const order: GestionNavGroupId[] = ["creation", "activite"];
  return order.map((id) => ({
    id,
    label: GESTION_NAV_GROUP_LABELS[id],
    links: GESTION_NAV_LINKS.filter((link) => link.group === id && !link.exact) as GestionNavLink[],
  }));
}
