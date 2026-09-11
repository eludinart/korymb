/** Identifiant du groupe d'agents associé à un job (défaut flotte métier). */
export function jobAgentGroupId(job: {
  mission_config?: { agent_group_id?: string | null } | null;
}): string {
  const raw = job.mission_config?.agent_group_id;
  const g = typeof raw === "string" ? raw.trim() : "";
  return g || "entreprise";
}

/** Libellé court pour badge / filtre. */
export function teamBadgeLabel(
  groupId: string,
  groupsById: Record<string, { label?: string } | undefined>,
): string {
  if (!groupId || groupId === "entreprise") return "Entreprise";
  return groupsById[groupId]?.label?.trim() || "Équipe projet";
}

/** Lead conversationnel : CIO pour la flotte métier, sinon lead d'équipe. */
export function missionLeadLabel(groupId: string): string {
  return !groupId || groupId === "entreprise" ? "CIO" : "lead";
}
