/** Navigation Gestion entreprise — source unique (header, sidebar, Ctrl+K). */

export type GestionNavLink = {
  href: string;
  label: string;
  hint: string;
  icon: string;
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

export const GESTION_NAV_LINKS: readonly GestionNavLink[] = [
  {
    href: GESTION_HUB_HREF,
    label: "Vue d'ensemble",
    hint: "Cockpit & indicateurs",
    icon: "📊",
    exact: true,
  },
  {
    href: "/gestion/contacts",
    label: "Contacts",
    hint: "Prospects, clients, partenaires",
    icon: "👤",
  },
  {
    href: "/gestion/projets",
    label: "Projets",
    hint: "Séances, stages, modules pro",
    icon: "📁",
  },
  {
    href: "/gestion/planning",
    label: "Planning",
    hint: "Agenda séances & stages",
    icon: "📅",
  },
  {
    href: "/gestion/devis",
    label: "Devis",
    hint: "Commercial · facture via Tiime",
    icon: "📝",
  },
] as const;

export const GESTION_QUICK_ACTIONS: readonly GestionQuickAction[] = [
  { id: "new-contact", href: "/gestion/contacts/nouveau", label: "Nouveau contact", hint: "Créer un contact" },
  { id: "new-project", href: "/gestion/projets/nouveau", label: "Nouveau projet", hint: "Créer un projet" },
  { id: "new-event", href: "/gestion/planning/nouveau", label: "Planifier un créneau", hint: "Ajouter au planning" },
  { id: "new-quote", href: "/gestion/devis/nouveau", label: "Nouveau devis", hint: "Créer un devis" },
] as const;

export function isGestionPath(pathname: string): boolean {
  return pathname === GESTION_HUB_HREF || pathname.startsWith(`${GESTION_HUB_HREF}/`);
}

export function isGestionLinkActive(pathname: string, link: GestionNavLink): boolean {
  if (link.exact) return pathname === link.href;
  return pathname === link.href || pathname.startsWith(`${link.href}/`);
}
