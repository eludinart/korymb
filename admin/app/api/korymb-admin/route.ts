import { NextRequest, NextResponse } from "next/server";

const base = (process.env.KORYMB_API_URL || "http://127.0.0.1:8002").replace(/\/$/, "");
const secret = process.env.KORYMB_AGENT_SECRET || "";

function headers() {
  return {
    "Content-Type": "application/json",
    "X-Agent-Secret": secret,
  };
}

export async function GET() {
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant dans .env.local" },
      { status: 500 },
    );
  }
  const r = await fetch(`${base}/admin/settings`, { headers: headers(), cache: "no-store" });
  const data = await r.json().catch(() => ({}));
  return NextResponse.json(data, { status: r.status });
}

export async function PUT(req: NextRequest) {
  if (!secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant dans .env.local" },
      { status: 500 },
    );
  }
  const body = await req.json().catch(() => ({}));
  const r = await fetch(`${base}/admin/settings`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  return NextResponse.json(data, { status: r.status });
}
