/** URL backend pour les routes API Next (serveur uniquement). */
export function serverKorymbApiBase(): string {
  const fromServer = process.env.KORYMB_API_URL?.trim();
  const fromPublic = process.env.NEXT_PUBLIC_KORYMB_API_URL?.trim();
  const isProd = process.env.NODE_ENV === "production";
  const raw = fromServer || fromPublic || (isProd ? "" : "http://127.0.0.1:8020");
  if (!raw) {
    throw new Error(
      "KORYMB_API_URL non configurée sur le service frontend (Coolify). " +
        "Ex. https://api-korymb.eludein.art ou l'URL interne du conteneur backend.",
    );
  }
  if (isProd && isLoopbackApiBase(raw)) {
    throw new Error(
      `KORYMB_API_URL pointe vers ${raw} — inaccessible depuis le conteneur Next en production.`,
    );
  }
  return raw.replace(/\/$/, "");
}

export function isLoopbackApiBase(base: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(base.trim());
}

export function backendUnreachableMessage(base: string, err?: unknown): string {
  const hint =
    process.env.NODE_ENV === "production"
      ? "Vérifiez que le service backend Coolify est démarré, écoute sur le port exposé (souvent 3000), et que KORYMB_API_URL pointe vers lui."
      : "Démarrez le backend local (port 8020), par ex. .\\start-dev-cursor.ps1 -MariaDbTunnel.";
  const detail = err instanceof Error ? err.message : err ? String(err) : "";
  return `Backend Korymb injoignable (${base}). ${hint}${detail ? ` (${detail})` : ""}`;
}
