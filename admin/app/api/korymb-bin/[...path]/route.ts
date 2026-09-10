import { NextRequest, NextResponse } from "next/server";
import { isProxyUnprotected, resolveProxySecret } from "../../../../lib/proxySecret";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";

export const maxDuration = 120;

function targetPath(path: string[]) {
  const joined = path.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function withAuthHeaders(request: NextRequest, joinedPath: string, secret: string, contentType: string | null) {
  const headers = new Headers();
  if (contentType) headers.set("Content-Type", contentType);
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
  const workspaceId = request.cookies.get(KORYMB_WORKSPACE_COOKIE)?.value?.trim() || "";
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  } else if (!isProxyUnprotected(joinedPath) && secret) {
    headers.set("X-Agent-Secret", secret);
  }
  return headers;
}

async function proxy(request: NextRequest, path: string[]) {
  const joinedPath = path.join("/");
  const secret = resolveProxySecret();
  if (!joinedPath) {
    return NextResponse.json({ error: "Path manquant" }, { status: 400 });
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
  if (!isProxyUnprotected(joinedPath)) {
    const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
    if (!token && !secret) {
      return NextResponse.json(
        {
          error:
            "Authentification requise — connectez-vous ou configurez KORYMB_AGENT_SECRET côté serveur Next.",
        },
        { status: 401 },
      );
    }
  }
  const upstream = new URL(`${base}${targetPath(path)}`);
  request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  const method = request.method;
  const incomingType = request.headers.get("content-type");
  const hasBody = method !== "GET" && method !== "HEAD";
  const headers = withAuthHeaders(request, joinedPath, secret, hasBody ? incomingType : null);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), 60_000);

  let response: Response;
  try {
    response = await fetch(upstream, {
      method,
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: hasBody ? await request.arrayBuffer() : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const refused =
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.toLowerCase().includes("fetch failed");
    const timedOut = msg.toLowerCase().includes("timeout") || msg.toLowerCase().includes("aborted");
    return NextResponse.json(
      {
        detail: refused
          ? backendUnreachableMessage(base, err)
          : timedOut
            ? `Backend Korymb trop lent ou bloqué (${joinedPath}).`
            : `Proxy fichiers : ${msg}`,
      },
      { status: timedOut ? 504 : 503 },
    );
  } finally {
    clearTimeout(timer);
  }

  const buf = await response.arrayBuffer();
  const out = new NextResponse(buf, { status: response.status });
  const pass = ["content-type", "content-disposition", "cache-control", "x-content-type-options"];
  for (const key of pass) {
    const value = response.headers.get(key);
    if (value) out.headers.set(key, value);
  }
  if (!out.headers.has("Cache-Control")) {
    out.headers.set("Cache-Control", "private, max-age=60");
  }
  return out;
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}
