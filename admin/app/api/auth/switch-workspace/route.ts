import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";
import { formatHttpApiErrorPayload } from "../../../../lib/api";

const ALLOWED_NEXT = new Set(["/briefing", "/inbox"]);

function cookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

function safeNext(raw: unknown): string {
  const value = String(raw || "").trim();
  return ALLOWED_NEXT.has(value) ? value : "/briefing";
}

export async function POST(request: NextRequest) {
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
  if (!token) {
    return NextResponse.json({ detail: "Authentification requise." }, { status: 401 });
  }

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
  const workspaceId = String(body?.workspace_id || "").trim();
  if (!workspaceId) {
    return NextResponse.json({ detail: "Espace manquant." }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${base}/platform/workspaces/${encodeURIComponent(workspaceId)}/open`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json({ detail: backendUnreachableMessage(base, err) }, { status: 503 });
  }

  const data = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    const detail = formatHttpApiErrorPayload(data) || "Ouverture impossible.";
    return NextResponse.json({ ...data, detail }, { status: upstream.status });
  }

  const response = NextResponse.json({
    ok: true,
    workspace_id: data.workspace_id || workspaceId,
    redirect: safeNext(body?.next),
  });
  response.cookies.set(KORYMB_WORKSPACE_COOKIE, String(data.workspace_id || workspaceId), cookieOpts(60 * 60 * 24 * 30));
  return response;
}
