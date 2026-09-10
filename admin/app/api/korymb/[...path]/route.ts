import { NextRequest, NextResponse } from "next/server";
import { isProxyUnprotected, resolveProxySecret } from "../../../../lib/proxySecret";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";

function targetPath(path: string[]) {
  const joined = path.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function upstreamTimeoutMs(joinedPath: string): number {
  const p = joinedPath.toLowerCase();
  if (p === "health" || p === "health/live" || p === "health/database" || p === "llm") return 8_000;
  if (p.startsWith("admin/reprise")) return 90_000;
  if (p.includes("emails/sync") || p === "business/emails/sync") return 90_000;
  if (p.includes("emails/suggest-replies")) return 60_000;
  if (p.includes("emails/send")) return 60_000;
  if (p === "tokens" || p === "jobs/light") return 15_000;
  if (p.startsWith("jobs/") && p.includes("log_offset")) return 60_000;
  return 30_000;
}

/** Headers upstream propres — ne jamais cloner request.headers (hop-by-hop / content-length
 *  provoquent `fetch failed` côté undici sur PATCH/POST). */
function withSecretHeaders(request: NextRequest, joinedPath: string, secret: string) {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "application/json");
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

  const timeoutMs = upstreamTimeoutMs(joinedPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), timeoutMs);

  let response: Response;
  try {
    const method = request.method.toUpperCase();
    const hasBody = method !== "GET" && method !== "HEAD";
    const rawBody = hasBody ? await request.text() : "";
    response = await fetch(upstream, {
      method: request.method,
      headers: withSecretHeaders(request, joinedPath, secret),
      cache: "no-store",
      signal: controller.signal,
      // Chaîne vide → undefined : évite un Content-Length forcé à tort par undici
      body: hasBody && rawBody.length > 0 ? rawBody : undefined,
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
            ? `Backend Korymb trop lent ou bloqué (${joinedPath}, délai ${timeoutMs} ms).`
            : `Proxy API : ${msg}`,
      },
      { status: timedOut ? 504 : 503 },
    );
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type") || "application/json";
  const raw = await response.text();
  return new NextResponse(raw, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

type RouteContext = { params: Promise<{ path: string[] }> };

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}
