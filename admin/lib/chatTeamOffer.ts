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

export type FleetPick = { id: string; label: string };

type FleetAnchorMessage = {
  id: string;
  role: string;
  content: string;
  fleetRelay?: unknown;
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FLEET_ANALYSIS_RE =
  /analyse poussee|analyse approfondie|analyse (de la |la |cette |notre )?situation|analyser (la |cette |notre )?situation|\bdiagnostic\b|etat des lieux|\baudit\b|vision d ensemble|plusieurs angles|situation (globale|actuelle|complexe)|\bapprofondi[rs]\b|\bcreuse[rz]?\b|va au fond|\barbitrage\b|comparer .{0,48}(options|scenarios|pistes|angles)|mobilise[rz]? (la |une )?(flotte|equipe)|passe[rz]? .{0,32}(a la |aux )?(flotte|equipe)|confie[rz]? .{0,40}(flotte|equipe)|demande[rz]? a (la |l )?(flotte|equipe)/i;

const FLEET_SOFT_RE = /\b(strategie|priorit|decid|situation|scenario|enjeu)\b/i;

const SIMPLE_ASSISTANT_RE =
  /\b(qui es[- ]tu|qui est[- ]tu|tu es qui|qui etes[- ]vous|presente[- ]toi)\b/i;

const FLEET_CONFIRM_RE =
  /^(oui|ouais|ok|okay|d accord|daccord|vas[- ]y|go|valide|valider|c est bon|parfait|fais[- ]le|je valide|confirme|confirmer|lance|lancer)\b/i;

const ASKS_FLEET_RE =
  /mobilise[rz]? (la |une )?(flotte|equipe)|passe[rz]? .{0,32}(a la |aux )?(flotte|equipe)|confie[rz]? .{0,40}(flotte|equipe)|demande[rz]? a (la |l )?(flotte|equipe)/i;

/** Aligné sur `message_warrants_existing_fleet` (backend). */
export function messageWarrantsFleetAnalysis(text: string): boolean {
  const folded = fold(text);
  if (!folded || SIMPLE_ASSISTANT_RE.test(folded)) return false;
  if (FLEET_ANALYSIS_RE.test(folded)) return true;
  return folded.length >= 280 && FLEET_SOFT_RE.test(folded);
}

export function isFleetConfirm(text: string): boolean {
  const folded = fold(text).replace(/[.!?]+$/, "").trim();
  if (!folded || folded.length > 80) return false;
  return FLEET_CONFIRM_RE.test(folded);
}

export function messageAsksExistingFleet(text: string): boolean {
  return ASKS_FLEET_RE.test(fold(text));
}

export function fleetNamedInText(text: string, fleets: FleetPick[]): FleetPick | null {
  const folded = fold(text);
  if (!folded) return null;
  const hits = fleets.filter((fleet) => {
    const label = fold(fleet.label);
    return label.length >= 3 && folded.includes(label);
  });
  if (!hits.length) return null;
  const bestLen = Math.max(...hits.map((fleet) => fold(fleet.label).length));
  const best = hits.filter((fleet) => fold(fleet.label).length === bestLen);
  return best.length === 1 ? best[0] : null;
}

/** Dernière demande d'analyse encore sans relais de flotte. */
export function fleetOfferAnchor(messages: FleetAnchorMessage[]): { id: string; text: string } | null {
  let skippedConfirm = false;
  let handoff: { id: string; text: string } | null = null;
  let analysis: { id: string; text: string } | null = null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.fleetRelay) return null;
    if (message.role !== "user") continue;
    const content = message.content || "";
    if (messageWarrantsFleetAnalysis(content)) {
      if (messageAsksExistingFleet(content)) {
        if (!handoff) handoff = { id: message.id, text: content };
        continue;
      }
      analysis = { id: message.id, text: content };
      break;
    }
    if (!skippedConfirm && isFleetConfirm(content)) {
      skippedConfirm = true;
      continue;
    }
    break;
  }
  if (!analysis && !handoff) return null;
  return {
    id: handoff?.id || analysis!.id,
    text: analysis?.text || handoff!.text,
  };
}

export function activeChatFleets<T extends FleetPick & { status?: string }>(groups: T[]): T[] {
  const active = groups.filter((group) => group.status !== "archived" && group.id && group.label);
  const enterprise = active.find((group) => group.id === "entreprise");
  const rest = active.filter((group) => group.id !== "entreprise");
  return enterprise ? [enterprise, ...rest] : rest;
}
