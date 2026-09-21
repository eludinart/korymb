/** Identités visuelles récurrentes : qui parle / quelle équipe. */

export const ENTERPRISE_GROUP_ID = "entreprise";
/** Rôle de la flotte métier (CIO) — pas un titre hiérarchique. */
export const ENTERPRISE_ROLE_LABEL = "Chef d'orchestre";

export type IdentityKind = "assistant" | "orchestra" | "project";

/** Identifiant du groupe d'agents associé à un job (défaut flotte métier). */
export function jobAgentGroupId(job: {
  mission_config?: { agent_group_id?: string | null } | null;
}): string {
  const raw = job.mission_config?.agent_group_id;
  const g = typeof raw === "string" ? raw.trim() : "";
  return g || ENTERPRISE_GROUP_ID;
}

export function isEnterpriseAgentGroup(groupId?: string | null): boolean {
  const g = (groupId || "").trim();
  return !g || g === ENTERPRISE_GROUP_ID;
}

export function identityFromGroupId(groupId?: string | null): Exclude<IdentityKind, "assistant"> {
  return isEnterpriseAgentGroup(groupId) ? "orchestra" : "project";
}

export function identityFromInterlocutor(value: string): IdentityKind {
  if (value === "assistant") return "assistant";
  if (value === "coordinateur" || value === `group:${ENTERPRISE_GROUP_ID}`) return "orchestra";
  if (value.startsWith("group:")) return "project";
  return "assistant";
}

/** Pastille : or = chef d'orchestre, ciel = équipe projet, violet = assistant. */
export const IDENTITY_BADGE: Record<IdentityKind, string> = {
  assistant: "bg-violet-50 text-violet-800 ring-1 ring-violet-200",
  orchestra: "bg-amber-100 text-amber-950 ring-1 ring-amber-300",
  project: "bg-sky-50 text-sky-800 ring-1 ring-sky-100",
};

export const IDENTITY_SELECT: Record<IdentityKind, string> = {
  assistant: "border-violet-200 bg-white text-slate-800",
  orchestra: "border-amber-400 bg-amber-50 text-amber-950",
  project: "border-sky-300 bg-sky-50 text-sky-950",
};

export const IDENTITY_BORDER: Record<IdentityKind, string> = {
  assistant: "border-violet-200",
  orchestra: "border-amber-300",
  project: "border-sky-200",
};

export const IDENTITY_CARD: Record<IdentityKind, string> = {
  assistant: "border-violet-200 bg-white",
  orchestra: "border-amber-300 bg-gradient-to-br from-amber-50 via-white to-white",
  project: "border-sky-100 bg-white",
};

export const IDENTITY_LIST_ACTIVE: Record<Exclude<IdentityKind, "assistant">, string> = {
  orchestra: "bg-amber-600 text-white shadow-sm",
  project: "bg-sky-600 text-white shadow-sm",
};

export const IDENTITY_LIST_IDLE: Record<Exclude<IdentityKind, "assistant">, string> = {
  orchestra: "ring-1 ring-amber-200 hover:bg-amber-50 text-amber-950",
  project: "hover:bg-sky-50 text-slate-800",
};

export const IDENTITY_ICON_BUTTON: Record<IdentityKind, string> = {
  assistant: "border-slate-200 text-slate-500 hover:bg-slate-50",
  orchestra: "border-amber-300 text-amber-800 hover:bg-amber-50",
  project: "border-sky-200 text-sky-700 hover:bg-sky-50",
};

/** Libellé court pour badge / filtre (nom du groupe). */
export function teamBadgeLabel(
  groupId: string,
  groupsById: Record<string, { label?: string } | undefined>,
): string {
  if (isEnterpriseAgentGroup(groupId)) return "Entreprise";
  return groupsById[groupId]?.label?.trim() || "Équipe projet";
}

/** Libellé d'identité : Chef d'orchestre vs nom d'équipe projet. */
export function teamIdentityLabel(
  groupId?: string | null,
  teamLabel?: string | null,
): string {
  if (isEnterpriseAgentGroup(groupId)) return ENTERPRISE_ROLE_LABEL;
  return (teamLabel || "").trim() || "Équipe projet";
}

export function teamBadgeClass(groupId?: string | null): string {
  return IDENTITY_BADGE[identityFromGroupId(groupId)];
}

/** Lead conversationnel : CIO pour la flotte métier, sinon lead d'équipe. */
export function missionLeadLabel(groupId: string): string {
  return isEnterpriseAgentGroup(groupId) ? "CIO" : "lead";
}

export type FleetPerimeterKind = "global" | "inherited" | "team" | "none";

export type FleetPerimeterInfo = {
  kind: FleetPerimeterKind;
  short: string;
  detail: string;
  isolated: boolean;
};

/** Périmètre mémoire / marque d'une flotte — aligné sur le backend (avec ou sans contexte global). */
export function fleetPerimeterInfo(group: {
  id?: string | null;
  memory_scope?: string | null;
  inherit_shared?: boolean | null;
  sees_workspace_identity?: boolean | null;
  policy?: { memory_scope?: string } | null;
}): FleetPerimeterInfo {
  const id = (group.id || "").trim();
  const scope = String(group.memory_scope || group.policy?.memory_scope || "")
    .trim()
    .toLowerCase();
  const inherit = Boolean(group.inherit_shared);
  const sees =
    typeof group.sees_workspace_identity === "boolean"
      ? group.sees_workspace_identity
      : isEnterpriseAgentGroup(id) || scope === "enterprise" || inherit;

  if (scope === "none") {
    return {
      kind: "none",
      short: "Sans mémoire",
      detail: "Aucun contexte métier injecté — uniquement le prompt de rôle et la consigne.",
      isolated: true,
    };
  }
  if (scope === "group" && !sees) {
    return {
      kind: "team",
      short: "Mémoire d'équipe seule",
      detail:
        "Périmètre isolé : la flotte n'utilise pas le contexte global (marque, mémoire partagée). Uniquement le brief d'équipe.",
      isolated: true,
    };
  }
  if (scope === "group" && inherit) {
    return {
      kind: "inherited",
      short: "Équipe + contexte global",
      detail: "Mémoire d'équipe, plus un extrait du contexte global du workspace.",
      isolated: false,
    };
  }
  return {
    kind: "global",
    short: "Contexte global",
    detail: "Cette flotte utilise la marque et la mémoire partagée du workspace.",
    isolated: false,
  };
}
