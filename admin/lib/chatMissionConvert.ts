import type { ChatMsg } from "../components/chat/ChatShell";

const MAX_MSG_CHARS = 1800;
const MAX_MISSION_CHARS = 12_000;

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Construit une consigne mission à partir d'un fil chat. */
export function buildMissionBriefFromChat(messages: ChatMsg[], conversationTitle?: string): string {
  const lines: string[] = [
    "Mission multi-agents — issue d'une conversation chat avec le dirigeant.",
    "",
    "## Objectif",
    clip(
      conversationTitle ||
        messages.find((m) => m.role === "user")?.content ||
        "Approfondir le sujet discuté en chat avec délégation CIO.",
      500,
    ),
    "",
    "## Contexte de l'échange (chat)",
  ];

  for (const m of messages) {
    const who = m.role === "user" ? "Dirigeant" : "CIO";
    lines.push(`**${who}** : ${clip(m.content, MAX_MSG_CHARS)}`, "");
  }

  lines.push(
    "## Consigne d'exécution",
    "À partir de cet échange, orchestrer une mission complète : analyse approfondie, délégation aux agents pertinents (commercial, community manager, développeur, comptable selon le sujet), et livrables opérationnels pour décision dirigeant.",
  );

  const body = lines.join("\n").trim();
  return body.length > MAX_MISSION_CHARS ? `${body.slice(0, MAX_MISSION_CHARS - 1)}…` : body;
}
