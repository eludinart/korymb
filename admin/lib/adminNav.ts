/** Source unique des liens d'administration (header AppNav + sidebar /administration). */
export const ADMIN_NAV_LINKS = [
  { href: "/administration/dashboard", label: "Tableau de bord santé" },
  { href: "/administration/agents", label: "Agents métiers" },
  { href: "/administration/playbooks", label: "Playbooks" },
  { href: "/administration/orchestration", label: "Orchestration CIO" },
  { href: "/administration/comportements", label: "Comportements moteur" },
  { href: "/administration/templates", label: "Templates de missions" },
  { href: "/administration/memory", label: "Mémoire entreprise" },
  { href: "/administration/reprise", label: "Audit reprise" },
  { href: "/administration/budget", label: "Budget & Coûts" },
  { href: "/administration/autonomie", label: "Tâches autonomes" },
  { href: "/administration/approbations", label: "Approbations" },
] as const;

export function isAdminLinkActive(pathname: string, href: string): boolean {
  return (
    pathname === href ||
    pathname.startsWith(`${href}/`) ||
    (href === "/administration/dashboard" && pathname === "/administration")
  );
}
