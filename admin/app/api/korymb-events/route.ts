import { NextResponse } from "next/server";
import { resolveProxySecret } from "../../../lib/proxySecret";

const base = (process.env.KORYMB_API_URL || process.env.NEXT_PUBLIC_KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");

export async function GET() {
  const secret = resolveProxySecret();
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant côté serveur Next (production : secret serveur uniquement)" },
      { status: 500 },
    );
  }
  const upstream = await fetch(`${base}/events/stream`, {
    cache: "no-store",
    headers: {
      "X-Agent-Secret": secret,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
  if (!upstream.ok || !upstream.body) {
    const payload = await upstream.text().catch(() => "");
    return new NextResponse(payload || "SSE upstream indisponible", { status: upstream.status || 502 });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
