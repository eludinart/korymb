import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";

const base = (process.env.KORYMB_API_URL || process.env.NEXT_PUBLIC_KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");

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
  const body = await request.json().catch(() => ({}));
  const res = await fetch(`${base}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(data, { status: res.status });
  }
  const token = String(data.token || "");
  const workspaceId = String(data.workspace?.id || "");
  const response = NextResponse.json({
    user: data.user,
    workspace: data.workspace,
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
