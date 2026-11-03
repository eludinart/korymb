import { NextRequest, NextResponse } from "next/server";
import { isProxyUnprotected } from "../../../../lib/proxyPaths";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../lib/serverApiBase";

export const runtime = "nodejs";
export const maxDuration = 120;

function targetPath(path: string[]) {
  const joined = path.join("/");
  return joined.startsWith("/") ? joined : `/${joined}`;
}

function withSessionHeaders(request: NextRequest, contentType: string | null) {
  const headers = new Headers();
  // Pour multipart/FormData, ne pas fixer Content-Type : fetch doit poser le boundary.
  if (contentType) headers.set("Content-Type", contentType);
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
  const workspaceId = request.cookies.get(KORYMB_WORKSPACE_COOKIE)?.value?.trim() || "";
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  return headers;
}

async function buildUpstreamBody(
  request: NextRequest,
): Promise<{ body?: BodyInit; contentType: string | null; error?: NextResponse }> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return { contentType: null };
  }
  const incomingType = (request.headers.get("content-type") || "").toLowerCase();
  if (incomingType.includes("multipart/form-data")) {
    // Rejouer les bytes bruts casse souvent le boundary (FastAPI → « Field required »).
    // On parse puis on laisse undici reconstruire un multipart valide.
    const form = await request.formData();
    const keys = [...form.keys()];
    if (!keys.length) {
      return {
        contentType: null,
        error: NextResponse.json(
          { detail: "Aucun fichier reçu par le proxy (formulaire vide)." },
          { status: 400 },
        ),
      };
    }
    return { body: form, contentType: null };
  }
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) {
    return { contentType: null };
  }
  return {
    body: buf,
    contentType: request.headers.get("content-type"),
  };
}

async function proxy(request: NextRequest, path: string[]) {
  const joinedPath = path.join("/");
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
    if (!token) {
      return NextResponse.json(
        { error: "Authentification requise — connectez-vous." },
        { status: 401 },
      );
    }
  }
  const upstream = new URL(`${base}${targetPath(path)}`);
  request.nextUrl.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  const prepared = await buildUpstreamBody(request);
  if (prepared.error) return prepared.error;
  const headers = withSessionHeaders(request, prepared.contentType);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), 60_000);

  let response: Response;
  try {
    response = await fetch(upstream, {
      method: request.method,
      headers,
      cache: "no-store",
      signal: controller.signal,
      body: prepared.body,
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
