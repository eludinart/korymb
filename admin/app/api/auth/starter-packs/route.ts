import { NextResponse } from "next/server";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";
import { resolveProxySecret } from "../../../../lib/proxySecret";

/** Catalogue public des modèles de démarrage (pas d'auth utilisateur). */
export async function GET() {
  let base: string;
  try {
    base = serverKorymbApiBase();
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Configuration API manquante." },
      { status: 503 },
    );
  }
  const secret = resolveProxySecret();
  const headers: HeadersInit = { Accept: "application/json" };
  if (secret) headers["X-Agent-Secret"] = secret;
  try {
    const res = await fetch(`${base}/auth/starter-packs`, {
      headers,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ detail: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}
