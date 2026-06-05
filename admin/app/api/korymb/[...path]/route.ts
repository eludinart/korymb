import { NextRequest, NextResponse } from "next/server";
import { PROXY_UNPROTECTED, resolveProxySecret } from "../../../../lib/proxySecret";

const base = (process.env.KORYMB_API_URL || process.env.NEXT_PUBLIC_KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");

function targetPath(path: string[]) {
  const joined = path.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function upstreamTimeoutMs(joinedPath: string): number {
  const p = joinedPath.toLowerCase();
  if (p === "health" || p === "health/live" || p === "health/database" || p === "llm") return 8_000;
  if (p.startsWith("admin/reprise")) return 90_000;
  if (p === "tokens" || p === "jobs/light") return 15_000;
  if (p.startsWith("jobs/") && p.includes("log_offset")) return 60_000;
  return 30_000;
}

function withSecretHeaders(request: NextRequest, joinedPath: string, secret: string) {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("host");
  if (!PROXY_UNPROTECTED.has(joinedPath) && secret) {
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
  if (!PROXY_UNPROTECTED.has(joinedPath) && !secret) {
    return NextResponse.json(
      { error: "KORYMB_AGENT_SECRET manquant côté serveur Next (production : secret serveur uniquement)" },
      { status: 500 },
    );
  }
  const upstream = new URL(`${base}${targetPath(path)}`);
  request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  const timeoutMs = upstreamTimeoutMs(joinedPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), timeoutMs);

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers: withSecretHeaders(request, joinedPath, secret),
      cache: "no-store",
      signal: controller.signal,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
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
          ? `Backend Korymb injoignable sur ${base}. Démarrez le backend (port 8020), par ex. .\\start-dev-cursor.ps1 -MariaDbTunnel.`
          : timedOut
            ? `Backend Korymb trop lent ou bloqué (${joinedPath}, délai ${timeoutMs} ms). Le watchdog dev devrait redémarrer le backend — rechargez la page.`
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
