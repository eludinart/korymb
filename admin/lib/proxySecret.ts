/**
 * Secret agent API — résolution serveur uniquement.
 * En production : KORYMB_AGENT_SECRET ou AGENT_API_SECRET obligatoires.
 * En dev local : repli documenté sur NEXT_PUBLIC_* / VITE_* (legacy).
 */
export function resolveProxySecret(): string {
  const primary =
    process.env.KORYMB_AGENT_SECRET?.trim() ||
    process.env.AGENT_API_SECRET?.trim() ||
    "";
  if (primary) return primary;

  const isProd = process.env.NODE_ENV === "production";
  if (isProd) return "";

  return (
    process.env.NEXT_PUBLIC_KORYMB_AGENT_SECRET?.trim() ||
    process.env.VITE_AGENT_SECRET?.trim() ||
    ""
  );
}

/** Routes proxyées sans X-Agent-Secret (bandeau runtime uniquement). */
export const PROXY_UNPROTECTED = new Set(["health", "llm"]);
