import { NextRequest, NextResponse } from "next/server";
import { resolveProxySecret } from "../../../lib/proxySecret";

const base = (process.env.KORYMB_API_URL || process.env.NEXT_PUBLIC_KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");

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
  const r = await fetch(`${base}/admin/settings`, { headers: headers(secret), cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  return NextResponse.json(data, {
    status: r.status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function PUT(req: NextRequest) {
  const secret = resolveProxySecret();
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant (production : secret serveur uniquement)" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
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
}
