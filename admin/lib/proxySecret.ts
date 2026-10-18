/**
 * Secret agent — serveur Next uniquement (`KORYMB_AGENT_SECRET`, repli `AGENT_API_SECRET`).
 * Le navigateur appelle `/api/korymb*` avec le cookie JWT (`korymb_token`). Ces routes
 * refusent la requête sans session (sauf chemins publics) et ne transmettent pas ce secret.
 * Hermes et les scripts appellent FastAPI directement avec `X-Agent-Secret`.
 * Ne jamais lire `NEXT_PUBLIC_KORYMB_AGENT_SECRET` : Next intègre ce préfixe au JavaScript du navigateur.
 */
export function resolveProxySecret(): string {
  return process.env.KORYMB_AGENT_SECRET?.trim() || process.env.AGENT_API_SECRET?.trim() || "";
}

export const PROXY_UNPROTECTED = new Set(["health", "health/live", "health/database", "llm"]);

export function isProxyUnprotected(joinedPath: string) {
  if (PROXY_UNPROTECTED.has(joinedPath)) return true;
  return joinedPath === "public" || joinedPath.startsWith("public/");
}
