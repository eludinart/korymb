export type OrbMood = "idle" | "preparing" | "searching" | "writing" | "speaking" | "waiting";

export type ChatReplyProgress = {
  percent: number;
  label: string;
  status?: string;
  /** Jalons déjà visibles, du plus ancien au plus récent. */
  steps?: string[];
};

type JobEvent = {
  type?: string;
  data?: { phase?: string };
  payload?: { phase?: string };
};

type JobTick = {
  status?: string;
  team?: Array<{ phase?: string; status?: string }>;
  events?: JobEvent[];
};

const EVENT_LINE: Record<string, string> = {
  mission_start: "J'ai pris votre demande",
  orchestration_start: "Je m'organise",
  synthesis_start: "Je rédige",
  synthesis_done: "Je relis",
  claim_guard: "Je vérifie les précisions",
  error: "Quelque chose a bloqué",
};

function eventBlob(event: JobEvent | undefined): string {
  const data = event?.data && typeof event.data === "object" ? event.data : {};
  const payload = event?.payload && typeof event.payload === "object" ? event.payload : {};
  const phase = String(payload.phase || data.phase || "");
  return `${phase} ${event?.type || ""}`.toLowerCase();
}

/** Humeur de l'orbe à partir de la phrase déjà montrée à l'écran. */
export function orbMoodFromLabel(label: string | undefined | null, active: boolean): OrbMood {
  if (!active) return "idle";
  const text = String(label || "").toLowerCase();
  if (/feu vert|attend/.test(text)) return "waiting";
  if (/cherch/.test(text)) return "searching";
  if (/rédig|redig|relis|réponse|reponse/.test(text)) return "writing";
  return "preparing";
}

/** Libellé de la barre d'attente à partir des jalons déjà exposés par le job. */
export function progressFromJob(data: JobTick): ChatReplyProgress {
  const status = String(data.status || "");
  const events = Array.isArray(data.events) ? data.events : [];
  const steps: string[] = [];
  for (const event of events) {
    const line = EVENT_LINE[String(event?.type || "")];
    if (line && steps[steps.length - 1] !== line) steps.push(line);
  }
  const last = events.length ? events[events.length - 1] : undefined;
  const teamPhase = (data.team || [])
    .map((row) => `${row.phase || ""} ${row.status || ""}`)
    .join(" ")
    .toLowerCase();
  const blob = `${eventBlob(last)} ${teamPhase}`;
  if (status === "awaiting_validation" || /validation|hitl/.test(blob)) {
    return { percent: 90, label: "J'attends votre feu vert", status, steps };
  }
  if (/search|cherche|web|research/.test(blob)) {
    if (steps[steps.length - 1] !== "Je cherche") steps.push("Je cherche");
    return { percent: 46, label: "Je cherche", status, steps };
  }
  if (/synth|reply|redige|write|llm/.test(blob)) {
    if (steps[steps.length - 1] !== "Je rédige") steps.push("Je rédige");
    return { percent: 72, label: "Je rédige", status, steps };
  }
  return { percent: 22, label: "Je prépare", status, steps };
}
