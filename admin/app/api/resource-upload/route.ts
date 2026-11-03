import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../lib/serverApiBase";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Relais binaire brut → POST /business/resource-files/raw
 * Pas de FormData / JSON : Next ne parse pas le corps, il le forward tel quel.
 */
export async function POST(request: NextRequest) {
  const token = request.cookies.get(KORYMB_TOKEN_COOKIE)?.value?.trim() || "";
  if (!token) {
    return NextResponse.json(
      { detail: "Authentification requise — connectez-vous." },
      { status: 401 },
    );
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

  const buf = await request.arrayBuffer();
  if (!buf.byteLength) {
    return NextResponse.json(
      { detail: "Fichier vide ou non reçu par le serveur web." },
      { status: 422 },
    );
  }

  const filenameHeader =
    request.headers.get("x-filename") ||
    request.headers.get("x-file-name") ||
    "fichier";
  const mimeHeader =
    request.headers.get("x-mime-type") ||
    request.headers.get("content-type") ||
    "application/octet-stream";

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/octet-stream");
  headers.set("Content-Length", String(buf.byteLength));
  headers.set("X-Filename", filenameHeader);
  headers.set("X-Mime-Type", mimeHeader.split(";")[0].trim() || "application/octet-stream");
  const workspaceId = request.cookies.get(KORYMB_WORKSPACE_COOKIE)?.value?.trim() || "";
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), 90_000);
  let response: Response;
  try {
    response = await fetch(`${base}/business/resource-files/raw`, {
      method: "POST",
      headers,
      body: buf,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const refused =
      msg.includes("ECONNREFUSED") ||
      msg.includes("ENOTFOUND") ||
      msg.toLowerCase().includes("fetch failed");
    const timedOut = /timeout|aborted/i.test(msg);
    return NextResponse.json(
      {
        detail: refused
          ? backendUnreachableMessage(base, err)
          : timedOut
            ? "Backend trop lent pendant l'upload."
            : `Upload : ${msg}`,
      },
      { status: timedOut ? 504 : 503 },
    );
  } finally {
    clearTimeout(timer);
  }

  const contentType = response.headers.get("content-type") || "application/json";
  const out = await response.arrayBuffer();
  return new NextResponse(out, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
