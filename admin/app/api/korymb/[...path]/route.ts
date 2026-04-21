import { NextRequest, NextResponse } from "next/server";

const base = (process.env.KORYMB_API_URL || process.env.NEXT_PUBLIC_KORYMB_API_URL || "http://127.0.0.1:8020").replace(/\/$/, "");
const secret =
  process.env.KORYMB_AGENT_SECRET ||
  process.env.AGENT_API_SECRET ||
  process.env.NEXT_PUBLIC_KORYMB_AGENT_SECRET ||
  process.env.VITE_AGENT_SECRET ||
  "";

const UNPROTECTED = new Set(["health", "health/tools", "probe/web-tools", "agents", "llm", "tokens", "events/stream"]);

function targetPath(path: string[]) {
  const joined = path.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function withSecretHeaders(request: NextRequest, joinedPath: string) {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json");
  headers.delete("host");
  if (!UNPROTECTED.has(joinedPath) && secret) {
    headers.set("X-Agent-Secret", secret);
  }
  return headers;
}

async function proxy(request: NextRequest, path: string[]) {
  const joinedPath = path.join("/");
  if (!joinedPath) {
    return NextResponse.json({ error: "Path manquant" }, { status: 400 });
  }
  if (!UNPROTECTED.has(joinedPath) && !secret) {
    return NextResponse.json({ error: "KORYMB_AGENT_SECRET manquant coté serveur Next" }, { status: 500 });
  }
  const upstream = new URL(`${base}${targetPath(path)}`);
  request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  const response = await fetch(upstream, {
    method: request.method,
    headers: withSecretHeaders(request, joinedPath),
    cache: "no-store",
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
  });

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

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path || []);
}
