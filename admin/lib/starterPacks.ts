/** Catalogue et labels des starter packs (amorçage workspace). */

export type StarterPackSummary = {
  id: string;
  label: string;
  description: string;
  playbook_count: number;
  mission_template_count: number;
  has_memory_seed: boolean;
};

export const FALLBACK_STARTER_PACKS: StarterPackSummary[] = [
  {
    id: "blank",
    label: "Commencer vide",
    description:
      "Espace générique. À spécialiser au fil de l'usage : mémoire, équipes, demandes.",
    playbook_count: 0,
    mission_template_count: 0,
    has_memory_seed: false,
  },
  {
    id: "accompagnement",
    label: "Accompagnement",
    description:
      "Notes de séance, accords / devis, ateliers, courriers de liaison. Modifiable ensuite.",
    playbook_count: 4,
    mission_template_count: 1,
    has_memory_seed: true,
  },
  {
    id: "contenu",
    label: "Création de contenu",
    description: "Articles, packs réseaux, PDF brandés. Compléter la charte dans la mémoire.",
    playbook_count: 3,
    mission_template_count: 1,
    has_memory_seed: true,
  },
];

export function starterPackLabel(packId: string | null | undefined): string {
  const id = (packId || "blank").trim() || "blank";
  const hit = FALLBACK_STARTER_PACKS.find((p) => p.id === id);
  return hit?.label || id;
}

export async function fetchStarterPacks(): Promise<StarterPackSummary[]> {
  try {
    const res = await fetch("/api/auth/starter-packs", { cache: "no-store" });
    if (!res.ok) return FALLBACK_STARTER_PACKS;
    const data = (await res.json()) as { packs?: StarterPackSummary[] };
    const packs = data.packs || [];
    return packs.length ? packs : FALLBACK_STARTER_PACKS;
  } catch {
    return FALLBACK_STARTER_PACKS;
  }
}
