/** Chemins proxy joignables sans cookie de session (santé, vitrine publique). */
const PROXY_UNPROTECTED = new Set(["health", "health/live", "health/database", "llm"]);

export function isProxyUnprotected(joinedPath: string) {
  if (PROXY_UNPROTECTED.has(joinedPath)) return true;
  return joinedPath === "public" || joinedPath.startsWith("public/");
}
