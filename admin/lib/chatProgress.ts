export type ChatReplyProgress = {
  percent: number;
  label: string;
  status?: string;
};

type JobTick = {
  status?: string;
  team?: Array<{ phase?: string; status?: string }>;
  events?: Array<{ type?: string; data?: { phase?: string } }>;
};

/** Libellé de la barre d'attente à partir des jalons déjà exposés par le job. */
export function progressFromJob(data: JobTick): ChatReplyProgress {
  const status = String(data.status || "");
  if (status === "awaiting_validation") {
    return { percent: 90, label: "J'attends votre feu vert", status };
  }
  const events = Array.isArray(data.events) ? data.events : [];
  const last = events.length ? events[events.length - 1] : undefined;
  const phase = `${last?.data?.phase || ""} ${last?.type || ""}`.toLowerCase();
  const teamPhase = (data.team || [])
    .map((row) => `${row.phase || ""} ${row.status || ""}`)
    .join(" ")
    .toLowerCase();
  const blob = `${phase} ${teamPhase}`;
  if (/search|cherche|web|research/.test(blob)) {
    return { percent: 46, label: "Je cherche", status };
  }
  if (/validation|hitl/.test(blob)) {
    return { percent: 88, label: "J'attends votre feu vert", status };
  }
  if (/synth|reply|redige|write|llm/.test(blob)) {
    return { percent: 72, label: "Je rédige", status };
  }
  return { percent: 22, label: "Je prépare", status };
}
