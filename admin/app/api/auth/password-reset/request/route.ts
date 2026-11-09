import { NextRequest, NextResponse } from "next/server";
import { formatHttpApiErrorPayload } from "../../../../../lib/api";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../../lib/serverApiBase";

export async function POST(request: NextRequest) {
  let base: string;
  try {
    base = serverKorymbApiBase();
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Configuration API manquante." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  let res: Response;
  try {
    res = await fetch(`${base}/auth/password-reset/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json({ detail: backendUnreachableMessage(base, err) }, { status: 503 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = formatHttpApiErrorPayload(data) || "Demande impossible.";
    return NextResponse.json({ ...data, detail }, { status: res.status });
  }
  return NextResponse.json(data);
}
