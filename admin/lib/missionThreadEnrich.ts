/** Marqueur des messages CIO → rôle (aligné sur mission.py `_human_dialogue_cio_assign`). */
const CIO_ASSIGN_MARK = "Voilà ce que je te propose de traiter :";

const AGENT_LABEL_TO_KEY: Record<string, string> = {
  commercial: "commercial",
  "community manager": "community_manager",
  developpeur: "developpeur",
  développeur: "developpeur",
  comptable: "comptable",
  coordinateur: "coordinateur",
};

function normalizeLabel(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Déduit la clé agent ciblée par « Bonjour Commercial, … ». */
export function agentKeyFromCioAssignGreeting(content: string, planKeys: string[]): string | undefined {
  const m = content.match(/Bonjour\s+([^,]+),/i);
  if (!m) return undefined;
  const label = normalizeLabel(m[1]);
  if (AGENT_LABEL_TO_KEY[label]) return AGENT_LABEL_TO_KEY[label];
  for (const key of planKeys) {
    const kNorm = normalizeLabel(key.replace(/_/g, " "));
    if (label === kNorm || label.includes(kNorm) || kNorm.includes(label)) return key;
  }
  return undefined;
}

function sousTachesFromPlan(plan: unknown): Record<string, string> {
  if (!plan || typeof plan !== "object") return {};
  const st = (plan as Record<string, unknown>).sous_taches;
  if (!st || typeof st !== "object" || Array.isArray(st)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(st)) {
    const text =
      typeof v === "string"
        ? v
        : v && typeof v === "object" && "description" in (v as object)
          ? String((v as { description?: string }).description || "")
          : String(v ?? "");
    if (text.trim()) out[k] = text.trim();
  }
  return out;
}

/**
 * Les messages « Bonjour {rôle}… Voilà ce que je te propose de traiter » étaient tronqués à ~1400 car.
 * en base ; on reconstruit le texte à partir du plan mission si la consigne complète y est encore.
 */
export function enrichCadrageThreadContent(
  content: string,
  plan: unknown,
): { text: string; wasEnriched: boolean } {
  const raw = String(content || "");
  if (!raw.includes(CIO_ASSIGN_MARK)) return { text: raw, wasEnriched: false };

  const st = sousTachesFromPlan(plan);
  const keys = Object.keys(st);
  if (!keys.length) return { text: raw, wasEnriched: false };

  const targetKey = agentKeyFromCioAssignGreeting(raw, keys);
  if (!targetKey) return { text: raw, wasEnriched: false };

  const fullTache = (st[targetKey] || "").replace(/\s+/g, " ").trim();
  if (fullTache.length < 400) return { text: raw, wasEnriched: false };

  const idx = raw.indexOf(CIO_ASSIGN_MARK);
  const embedded = raw
    .slice(idx + CIO_ASSIGN_MARK.length)
    .trim()
    .replace(/…$/u, "")
    .trim();

  if (embedded.length >= fullTache.length - 80) return { text: raw, wasEnriched: false };

  const embeddedStart = embedded.slice(0, Math.min(180, embedded.length));
  if (embeddedStart && !fullTache.startsWith(embeddedStart)) return { text: raw, wasEnriched: false };

  const greet = raw.match(/^([\s\S]*?Voilà ce que je te propose de traiter\s*:)\s*/i);
  if (!greet) return { text: raw, wasEnriched: false };

  return { text: `${greet[1]} ${fullTache}`, wasEnriched: true };
}

/** Réponses agents miroirées dans le fil (backend `_clip_dialogue_public`, 10 000 car.). */
export function isThreadContentLikelyTruncated(content: string): boolean {
  const t = String(content || "").trim();
  if (!t) return false;
  if (t.endsWith("…") || t.endsWith("...")) return true;
  return t.length >= 9_900;
}
