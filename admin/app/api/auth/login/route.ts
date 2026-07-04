import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";
import { formatHttpApiErrorPayload } from "../../../../lib/api";

function cookieOpts(maxAgeSec: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSec,
  };
}

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
    res = await fetch(`${base}/auth/login`, {
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
    const detail = formatHttpApiErrorPayload(data) || "E-mail ou mot de passe incorrect.";
    return NextResponse.json({ ...data, detail }, { status: res.status });
  }
  const token = String(data.token || "");
  const workspaceId = String(data.workspace?.id || "");
  const response = NextResponse.json({
    user: data.user,
    workspace: data.workspace,
    workspaces: data.workspaces,
    role: data.role,
  });
  if (token) {
    response.cookies.set(KORYMB_TOKEN_COOKIE, token, cookieOpts(60 * 60 * 24 * 7));
  }
  if (workspaceId) {
    response.cookies.set(KORYMB_WORKSPACE_COOKIE, workspaceId, cookieOpts(60 * 60 * 24 * 30));
  }
  return response;
}
