/**
 * Réordonne le markdown CIO courant : la synthèse décisionnelle (livrab / liste) passe avant
 * le bloc « Réponses des rôles » (conversations inter-agents dans un même message).
 */

export type CioResultSplit = {
  /** Texte à afficher en premier (synthèse, livrables actionnables, éventuel préambule hors rôles). */
  primary: string;
  /** Bloc « Réponses des rôles » et suite directe (détail par rôle), ou chaîne vide. */
  rolesDetail: string;
};

function headingSliceStart(m: RegExpMatchArray): number {
  const i = m.index ?? 0;
  return m[0].startsWith("\n") ? i + 1 : i;
}

/**
 * Détecte `## Réponses des rôles` et `## Synthèse` / `## Synthèse décisionnelle` (insensible à la casse).
 * Si les deux existent et que les rôles précèdent la synthèse dans le texte, inverse l’ordre d’affichage.
 */
export function splitCioSynthesisAndRoles(raw: string): CioResultSplit {
  const src = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!src.trim()) return { primary: "", rolesDetail: "" };

  const reRoles = /(?:^|\n)##\s+Réponses\s+des\s+rôles\b/im;
  const reSynth = /(?:^|\n)##\s+Synthèse(?:\s+décisionnelle)?\b/im;

  const mR = src.match(reRoles);
  const mS = src.match(reSynth);
  const idxR = mR ? headingSliceStart(mR) : -1;
  const idxS = mS ? headingSliceStart(mS) : -1;

  if (idxR < 0 && idxS < 0) {
    return { primary: src.trim(), rolesDetail: "" };
  }
  if (idxR >= 0 && idxS < 0) {
    const before = src.slice(0, idxR).trim();
    const roles = src.slice(idxR).trim();
    return { primary: before ? `${before}\n\n${roles}` : roles, rolesDetail: "" };
  }
  if (idxS >= 0 && idxR < 0) {
    const before = src.slice(0, idxS).trim();
    const synth = src.slice(idxS).trim();
    return { primary: [before, synth].filter(Boolean).join("\n\n"), rolesDetail: "" };
  }

  if (idxR < idxS) {
    const beforeRoles = src.slice(0, idxR).trim();
    const rolesBlock = src.slice(idxR, idxS).trim();
    const synthBlock = src.slice(idxS).trim();
    const primary = [synthBlock, beforeRoles].filter(Boolean).join("\n\n");
    return { primary: primary || synthBlock, rolesDetail: rolesBlock };
  }

  const beforeSynth = src.slice(0, idxS).trim();
  const synthBlock = src.slice(idxS, idxR).trim();
  const rolesBlock = src.slice(idxR).trim();
  return {
    primary: [beforeSynth, synthBlock].filter(Boolean).join("\n\n") || synthBlock,
    rolesDetail: rolesBlock,
  };
}
