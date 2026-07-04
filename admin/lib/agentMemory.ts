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
  global: "Contexte global (entreprise + priorités — partagé avec le CIO)",
  commercial: "Commercial",
  community_manager: "Gestionnaire de communauté",
  developpeur: "Développeur",
  comptable: "Comptable",
};

/** Le coordinateur (CIO) n'a pas de volet séparé : il lit le contexte global. */
export const CIO_MEMORY_NOTE =
  "Le CIO / coordinateur injecte le volet « Contexte global » dans son prompt (pas de clé coordinateur distincte).";

/** Volet mémoire associé à la fiche d’un agent (CIO → contexte global). */
export function memoryContextKeyForAgent(agentKey: string): string | null {
  if (!agentKey) return null;
  if (agentKey === "coordinateur") return "global";
  return agentKey;
}
