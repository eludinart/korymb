import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";

export async function GET(request: NextRequest) {
  let base: string;
  try {
    base = serverKorymbApiBase();
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Configuration API manquante." },
      { status: 503 },
    );
  }

  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
  const workspaceId = request.cookies.get(KORYMB_WORKSPACE_COOKIE)?.value?.trim() || "";
  if (!token) {
    return NextResponse.json({ user: null, workspace: null, role: null }, { status: 401 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  if (workspaceId) headers["X-Workspace-Id"] = workspaceId;

  try {
    const res = await fetch(`${base}/auth/me`, { headers, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ detail: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}
