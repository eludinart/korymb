/** Mode d'usage du chat — quotidien (Gemini-like) vs opérationnel (QG). */

export type ChatUseMode = "quotidien" | "operationnel";

const LS_KEY = "korymb-chat-use-mode";

export function normalizeChatUseMode(raw: unknown): ChatUseMode {
  return String(raw || "").trim().toLowerCase() === "operationnel" ? "operationnel" : "quotidien";
}

export function loadChatUseMode(): ChatUseMode {
  if (typeof window === "undefined") return "quotidien";
  try {
    return normalizeChatUseMode(localStorage.getItem(LS_KEY));
  } catch {
    return "quotidien";
  }
}

export function saveChatUseMode(mode: ChatUseMode) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, normalizeChatUseMode(mode));
  } catch {
    /* ignore */
  }
}

export const CHAT_USE_MODE_OPTIONS: { id: ChatUseMode; label: string; hint: string }[] = [
  { id: "quotidien", label: "Quotidien", hint: "Réponses rapides, conversation libre" },
  { id: "operationnel", label: "Ops", hint: "Flottes, missions, HITL" },
];

/** Chips de reformulation (mode quotidien). */
export const CHAT_QUICK_CHIPS = [
  { label: "Plus court", text: "Reformule ta dernière réponse en plus court." },
  { label: "En puces", text: "Reformule ta dernière réponse en puces claires." },
  { label: "Continuer", text: "Continue à partir de ta dernière réponse." },
] as const;

export const CHAT_PERSO_TITLE = "Perso";

/** Nombre de tours d'historique envoyés au backend. */
export function chatHistoryLimit(mode: ChatUseMode): number {
  return mode === "quotidien" ? 24 : 12;
}
