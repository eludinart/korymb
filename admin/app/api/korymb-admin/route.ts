import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../lib/serverApiBase";

function sessionHeaders(request: NextRequest): Headers | NextResponse {
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
  if (!token) {
    return NextResponse.json({ error: "Authentification requise — connectez-vous." }, { status: 401 });
  }
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${token}`);
  const workspaceId = request.cookies.get(KORYMB_WORKSPACE_COOKIE)?.value?.trim() || "";
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  return headers;
}

export async function GET(request: NextRequest) {
  const headers = sessionHeaders(request);
  if (headers instanceof NextResponse) return headers;
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
    const r = await fetch(`${base}/admin/settings`, { headers, cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    return NextResponse.json(data, {
      status: r.status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (err) {
    return NextResponse.json({ error: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const headers = sessionHeaders(request);
  if (headers instanceof NextResponse) return headers;
  let base: string;
  try {
    base = serverKorymbApiBase();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Configuration API manquante." },
      { status: 503 },
    );
  }
  const body = await request.json().catch(() => ({}));
  try {
    const r = await fetch(`${base}/admin/settings`, {
      method: "PUT",
      headers,
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
