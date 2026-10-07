const DELIVERABLE_RE = /\b(envoie|envoyer|publie|publier|livrable|r[eé]dige|devis|dossier)\b/i;
const SEARCH_RE = /\b(recherche|cherche|trouve)\b/i;

/** Vrai si la demande mérite d'être proposée à l'équipe (livrable, envoi, recherche longue). */
export function messageWantsTeam(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  if (DELIVERABLE_RE.test(raw)) return true;
  if (SEARCH_RE.test(raw) && raw.length >= 80) return true;
  return raw.length >= 400;
}
