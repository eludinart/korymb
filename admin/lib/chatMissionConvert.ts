import type { ChatMsg } from "../components/chat/ChatShell";

const MAX_MSG_CHARS = 600;
const MAX_MISSION_CHARS = 12_000;

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function extractCioMissionBrief(messages: ChatMsg[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== "assistant") continue;
    const c = (m.content || "").trim();
    if (c.includes("## Objectif") && (c.includes("## Livrables") || c.includes("## Consigne"))) {
      return clip(c, MAX_MISSION_CHARS);
    }
  }
  return null;
}

/** Construit une consigne mission structurée à partir d'un fil chat. */
export function buildMissionBriefFromChat(messages: ChatMsg[], conversationTitle?: string): string {
  const cio = extractCioMissionBrief(messages);
  if (cio) {
    const body = `Mission multi-agents — brief CIO issu du chat.\n\n${cio}`;
    return body.length > MAX_MISSION_CHARS ? `${body.slice(0, MAX_MISSION_CHARS - 1)}…` : body;
  }

  const userMsgs = messages.filter((m) => m.role === "user");
  const lastUser = userMsgs[userMsgs.length - 1]?.content || "";
  const lastAsst = [...messages].reverse().find((m) => m.role === "assistant")?.content || "";
  const recent = messages.slice(-6);

  const lines: string[] = [
    "Mission multi-agents — issue d'une conversation chat avec le dirigeant.",
    "",
    "## Objectif",
    clip(conversationTitle || lastUser || "Approfondir le sujet discuté en chat.", 500),
    "",
    "## Hors-périmètre",
    "Ne pas élargir au-delà de la demande (pas de roadmap, tarot ou partenariats non demandés).",
    "",
    "## Contexte (extraits récents)",
  ];

  for (const m of recent) {
    const who = m.role === "user" ? "Dirigeant" : "CIO";
    lines.push(`**${who}** : ${clip(m.content, MAX_MSG_CHARS)}`, "");
  }

  if (lastAsst && !recent.some((m) => m.role === "assistant" && m.content === lastAsst)) {
    lines.push(`**CIO (synthèse)** : ${clip(lastAsst, MAX_MSG_CHARS)}`, "");
  }

  lines.push(
    "## Livrables attendus",
    "Pièces opérationnelles pour décision dirigeant (pas un résumé d'intention).",
    "",
    "## Consigne d'exécution",
    "Orchestrer une mission complète à partir de l'objectif. Déléguer seulement si un rôle spécialisé est nécessaire.",
  );

  const body = lines.join("\n").trim();
  return body.length > MAX_MISSION_CHARS ? `${body.slice(0, MAX_MISSION_CHARS - 1)}…` : body;
}
