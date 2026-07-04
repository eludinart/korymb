import { NextResponse } from "next/server";
import { resolveProxySecret } from "../../../lib/proxySecret";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../lib/serverApiBase";

export async function GET() {
  const secret = resolveProxySecret();
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant côté serveur Next (production : secret serveur uniquement)" },
      { status: 500 },
    );
  }
  let base: string;
  try {
    base = serverKorymbApiBase();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Configuration API manquante." },
      { status: 503 },
    );
  }
  try {
    const upstream = await fetch(`${base}/events/stream`, {
      cache: "no-store",
      headers: {
        "X-Agent-Secret": secret,
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text().catch(() => "");
      return NextResponse.json(
        { error: text || `SSE upstream HTTP ${upstream.status}` },
        { status: upstream.status || 502 },
      );
    }
    return new NextResponse(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (err) {
    return NextResponse.json({ error: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}
