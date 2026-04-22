/**
 * Utilitaires pour extraire et afficher le résumé opérationnel CIO
 * depuis le champ `result` d'un job.
 *
 * Ordre de priorité :
 *   1. ## BILAN OPÉRATIONNEL / ## BILAN CUMULÉ  (nouvelles missions)
 *   2. Section "Synthèse décisionnelle du CIO"   (missions existantes)
 *   3. Premières lignes courtes en fallback
 */

/**
 * Supprime les code fences extérieures si le modèle a enveloppé toute sa réponse dans ```...```
 */
function stripOuterCodeFence(s: string): string {
  const trimmed = s.trim();
  if (!trimmed.startsWith("```")) return s;
  const afterOpen = trimmed.replace(/^```[a-zA-Z]*\r?\n?/, "");
  const afterClose = afterOpen.replace(/\r?\n?```\s*$/, "");
  return afterClose.trim().length > 40 ? afterClose.trim() : s;
}

/** Extrait ## BILAN OPÉRATIONNEL ou ## BILAN CUMULÉ. */
export function extractBilan(result: string | null | undefined): string | null {
  if (!result?.trim()) return null;
  const clean = stripOuterCodeFence(result);

  // Cherche "## BILAN …" jusqu'au prochain heading ou fin
  const match = clean.match(
    /##\s*BILAN\s*[A-ZÀÉÈÊËÎÏÔÙÛÜ\s]+\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i,
  );
  if (match) {
    const body = match[1].trim();
    if (body.length > 30) return body;
  }

  // Sans ## (au cas où le modèle omet le #)
  const noHash = clean.match(
    /^BILAN\s*[A-ZÀÉÈÊËÎÏÔÙÛÜ\s]*[\n:]([\s\S]*?)(?=\n##\s|\n#\s|\n[A-Z]{4}|\n\n\n|$)/im,
  );
  if (noHash) {
    const body = noHash[1].trim();
    if (body.length > 30) return body;
  }

  return null;
}

/**
 * Extrait la section "Synthèse décisionnelle du CIO" pour les missions
 * sans bloc BILAN structuré (format ancien ou mission sans structuration).
 * Retourne le contenu complet de la section.
 */
export function extractSynthese(result: string | null | undefined): string | null {
  if (!result?.trim()) return null;

  // Cherche "Synthèse décisionnelle" ou "Synthese decisionnelle" avec contenu
  const match = result.match(
    /synth[eè]se\s+d[eé]cisionnelle[^\n]*\n([\s\S]*?)(?=\n##|\n#[^#]|$)/i,
  );
  if (match) {
    const lines = match[1]
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length >= 2) return lines.join("\n");
  }

  return null;
}

/**
 * Meilleur résumé court disponible pour affichage principal :
 * BILAN structuré → Synthèse décisionnelle → 5 premières lignes.
 */
export function extractShortSummary(result: string | null | undefined): {
  text: string;
  source: "bilan" | "synthese" | "auto";
} {
  if (!result?.trim()) return { text: "", source: "auto" };

  const bilan = extractBilan(result);
  if (bilan) return { text: bilan, source: "bilan" };

  const synthese = extractSynthese(result);
  if (synthese) return { text: synthese, source: "synthese" };

  // Dernier recours : 5 lignes max (pas 20)
  const lines = result
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 5)
    .join("\n");
  return { text: lines, source: "auto" };
}

/**
 * Extrait la section "## QUESTIONS STRATÉGIQUES DU CIO" du résultat.
 * Retourne le contenu brut (liste numérotée de questions) ou null si absent.
 */
export function extractCioStrategicQuestions(result: string | null | undefined): string | null {
  if (!result?.trim()) return null;

  const match = result.match(
    /##\s*QUESTIONS?\s+STRAT[EÉ]GIQUES?\s+DU\s+CIO[^\n]*\n([\s\S]*?)(?=\n##\s|\n#\s|$)/i,
  );
  if (match) {
    const body = match[1].trim();
    if (body.length > 10) return body;
  }
  return null;
}

/** Retourne les N premières lignes non-vides du résultat. */
export function firstNLines(result: string | null | undefined, n = 30): string {
  if (!result?.trim()) return "";
  return result
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .slice(0, n)
    .join("\n");
}

/**
 * Retourne le meilleur résumé pour le preview de carte mission (liste).
 * Priorité : bilan CIO > synthèse décisionnelle > premières lignes.
 */
export function bestPreview(result: string | null | undefined, maxLines = 25): string {
  const { text } = extractShortSummary(result);
  if (text) return text;
  return firstNLines(result, maxLines);
}
