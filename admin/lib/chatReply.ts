/** Cible d'une réponse façon messagerie : le modèle reçoit la citation, l'UI affiche l'extrait. */
export type ChatReplyTarget = {
  id: string;
  role: "user" | "assistant";
  excerpt: string;
};

const EXCERPT_MAX = 220;

/** Texte court, sans markdown, pour la pastille de citation. */
export function chatReplyExcerpt(text: string, max = EXCERPT_MAX): string {
  const flat = String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!flat) return "";
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const base = space > 80 ? cut.slice(0, space) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Préfixe le tour envoyé au modèle pour qu'il réponde au message cité,
 * sans modifier le texte affiché dans la bulle.
 */
export function chatTextWithReply(content: string, replyTo?: ChatReplyTarget | null): string {
  const body = String(content || "").trim();
  const excerpt = String(replyTo?.excerpt || "").trim();
  if (!excerpt) return body;
  const who = replyTo?.role === "user" ? "vous" : "l'agent";
  const cue = `[Je réponds à ce message de ${who} : « ${excerpt} »]`;
  return body ? `${cue}\n${body}` : cue;
}
