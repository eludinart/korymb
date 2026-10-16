/**
 * Secret agent API — résolution serveur uniquement.
 * Les proxies navigateur (`/api/korymb`, événements, réglages) ne l'envoient pas :
 * sans cookie de session, la requête est refusée. Hermes et les scripts appellent
 * l'API FastAPI directement avec `X-Agent-Secret`.
 * En production : KORYMB_AGENT_SECRET ou AGENT_API_SECRET.
 * Jamais de préfixe NEXT_PUBLIC_ : il serait intégré au JavaScript du navigateur.
 */
export function resolveProxySecret(): string {
  return process.env.KORYMB_AGENT_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim() || "";
}

export const PROXY_UNPROTECTED = new Set(["health", "health/live", "health/database", "llm"]);

export function isProxyUnprotected(joinedPath: string) {
  if (PROXY_UNPROTECTED.has(joinedPath)) return true;
  return joinedPath === "public" || joinedPath.startsWith("public/");
}
