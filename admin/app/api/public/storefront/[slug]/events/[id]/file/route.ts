import { NextRequest, NextResponse } from "next/server";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../../../../../../lib/serverApiBase";

export const maxDuration = 60;

type RouteContext = { params: Promise<{ slug: string; id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { slug, id } = await context.params;
  let base: string;
  try {
    base = serverKorymbApiBase();
  } catch (err) {
    return NextResponse.json(
      { detail: err instanceof Error ? err.message : "Configuration API manquante." },
      { status: 503 },
    );
  }
  const inline = request.nextUrl.searchParams.get("inline") === "true";
  const upstream = `${base}/public/storefront/${encodeURIComponent(slug)}/events/${encodeURIComponent(id)}/file${inline ? "?inline=true" : ""}`;
  try {
    const res = await fetch(upstream, { cache: "no-store" });
    const buf = await res.arrayBuffer();
    const out = new NextResponse(buf, { status: res.status });
    const pass = ["content-type", "content-disposition", "cache-control", "x-content-type-options"];
    for (const key of pass) {
      const value = res.headers.get(key);
      if (value) out.headers.set(key, value);
    }
    return out;
  } catch (err) {
    return NextResponse.json({ detail: backendUnreachableMessage(base, err) }, { status: 503 });
  }
}
