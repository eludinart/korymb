import { NextRequest, NextResponse } from "next/server";
import { resolveProxySecret } from "../../../lib/proxySecret";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../lib/serverApiBase";

function headers(secret: string) {
  return {
    "Content-Type": "application/json",
    "X-Agent-Secret": secret,
  };
}

export async function GET() {
  const secret = resolveProxySecret();
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant (production : secret serveur uniquement)" },
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
    const r = await fetch(`${base}/admin/settings`, { headers: headers(secret), cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, {
      status: r.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json({ error: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}

export async function PUT(req: NextRequest) {
  const secret = resolveProxySecret();
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant (production : secret serveur uniquement)" },
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
  const body = await req.json().catch(() => ({}));
  try {
    const r = await fetch(`${base}/admin/settings`, {
      method: "PUT",
      headers: headers(secret),
      cache: "no-store",
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, {
      status: r.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json({ error: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}
