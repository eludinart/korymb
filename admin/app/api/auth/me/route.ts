import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { resolveProxySecret } from "../../../../lib/proxySecret";
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
  const secret = resolveProxySecret();

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    if (workspaceId) headers["X-Workspace-Id"] = workspaceId;
  } else if (secret) {
    headers["X-Agent-Secret"] = secret;
  } else {
    return NextResponse.json({ user: null, workspace: null, role: null }, { status: 401 });
  }

  try {
    const res = await fetch(`${base}/auth/me`, { headers, cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json({ detail: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}
