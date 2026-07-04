import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { resolveProxySecret } from "../../../../lib/proxySecret";

const base = (process.env.KORYMB_API_URL || process.env.NEXT_PUBLIC_KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");

export async function GET(request: NextRequest) {
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

  const res = await fetch(`${base}/auth/me`, { headers, cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  return NextResponse.json(data, { status: res.status });
}
