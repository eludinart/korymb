/** Marqueur partagé avec backend/services/llm_degraded.py. */
export const DEGRADED_MARKER = "[[korymb-degraded]]";

const IDENTITY =
  /qui (?:es|est|êtes|etes)[-\s]?(?:tu|vous)|tu es qui|qui suis-je|présente[-\s]?toi|presente[-\s]?toi|c['’]est qui/i;

export function chatTextIsDegraded(content: string | undefined | null): boolean {
  return String(content || "").includes(DEGRADED_MARKER);
}

export function stripDegradedMarker(content: string | undefined | null): string {
  return String(content || "").split(DEGRADED_MARKER).join("").trim();
}

/** Réponse locale si le POST /chat lui-même échoue (timeout navigateur, HTTP 5xx). */
export function localDegradedChatReply(userText: string, agentLabel = "Korymb"): string {
  const notice =
    `${DEGRADED_MARKER}\n` +
    "**Mode dégradé** — le modèle ne répond pas (crédit, quota ou délai). " +
    "Cette réponse est locale, sans appel au modèle.";
  const msg = userText.trim();
  if (IDENTITY.test(msg)) {
    return (
      `${notice}\n\n` +
      `Je suis **${agentLabel}**, dans la plateforme Korymb. ` +
      "En temps normal je m'appuie sur le modèle configuré pour répondre et lancer des missions. " +
      "Là, je ne peux pas l'interroger. " +
      "Vérifiez le crédit du fournisseur dans **Administration → LLM**, puis renvoyez votre message."
    );
  }
  const preview = msg.slice(0, 280);
  const received = preview ? `J'ai bien reçu : « ${preview}${msg.length > 280 ? "…" : ""} ».\n\n` : "";
  return (
    `${notice}\n\n${received}` +
    "Je ne peux pas traiter cette demande tant que le modèle est indisponible. " +
    "La conversation est conservée : renvoyez le message dès que le service est rétabli."
  );
}

export function isChatTransportFailure(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err || "")).toLowerCase();
  if (!msg || msg === "timeout") return true;
  return /aborted|http 5\d\d|502|503|504|429|402|quota|crédit|credit|trop lent|délai/.test(msg);
}
