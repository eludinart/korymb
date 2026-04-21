/** Clés persistées côté backend (`enterprise_memory.contexts_json`). */
export const MEMORY_CONTEXT_KEYS = [
  "global",
  "commercial",
  "community_manager",
  "developpeur",
  "comptable",
] as const;

export type MemoryContextKey = (typeof MEMORY_CONTEXT_KEYS)[number];

export const MEMORY_CONTEXT_TITLES: Record<MemoryContextKey, string> = {
  global: "Contexte global (entreprise)",
  commercial: "Commercial",
  community_manager: "Gestionnaire de communauté",
  developpeur: "Développeur",
  comptable: "Comptable",
};

/** Volet mémoire associé à la fiche d’un agent (CIO → contexte global). */
export function memoryContextKeyForAgent(agentKey: string): string | null {
  if (!agentKey) return null;
  if (agentKey === "coordinateur") return "global";
  return agentKey;
}
