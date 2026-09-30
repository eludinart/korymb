/**
 * Couleurs des rôles agents (pastilles chat, missions, templates).
 * Le CIO suit l'identité « chef d'orchestre » (ambre) ; le comptable est en teal
 * pour ne pas le confondre avec cette identité.
 */
const ROLE_CHIP: Record<string, string> = {
  assistant: "bg-violet-600 text-white",
  coordinateur: "bg-amber-600 text-white",
  commercial: "bg-blue-600 text-white",
  community_manager: "bg-pink-600 text-white",
  developpeur: "bg-emerald-600 text-white",
  comptable: "bg-teal-600 text-white",
};

const ROLE_SOFT: Record<string, string> = {
  assistant: "bg-violet-100 text-violet-900 dark:bg-violet-900 dark:text-violet-100",
  coordinateur: "bg-amber-100 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
  commercial: "bg-blue-100 text-blue-900 dark:bg-blue-900 dark:text-blue-100",
  community_manager: "bg-pink-100 text-pink-900 dark:bg-pink-900 dark:text-pink-100",
  developpeur: "bg-emerald-100 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100",
  comptable: "bg-teal-100 text-teal-900 dark:bg-teal-900 dark:text-teal-100",
};

export function agentRoleChipClass(agentKey: string): string {
  return ROLE_CHIP[agentKey.trim().toLowerCase()] || "bg-slate-600 text-white";
}

export function agentRoleSoftClass(agentKey: string): string {
  return ROLE_SOFT[agentKey.trim().toLowerCase()] || "bg-slate-100 text-slate-800";
}
