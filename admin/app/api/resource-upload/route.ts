import { NextRequest, NextResponse } from "next/server";
import { KORYMB_TOKEN_COOKIE, KORYMB_WORKSPACE_COOKIE } from "../../../lib/authSession";
import { backendUnreachableMessage, serverKorymbApiBase } from "../../../lib/serverApiBase";

export const runtime = "nodejs";
export const maxDuration = 120;

/**
 * Upload fichier → backend multipart, sans passer par le proxy générique
 * (korymb-bin / korymb JSON) qui cassait le champ `file` ou tronquait le JSON.
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

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json(
      { detail: "Impossible de lire le fichier (formulaire invalide)." },
      { status: 400 },
    );
  }

  const file = incoming.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { detail: "Fichier manquant (champ « file »)." },
      { status: 422 },
    );
  }
  if (!file.size) {
    return NextResponse.json({ detail: "Fichier vide." }, { status: 422 });
  }

  const filename = (file.name || String(incoming.get("filename") || "fichier")).slice(0, 160);

  const outbound = new FormData();
  outbound.append("file", file, filename);

  const headers = new Headers();
  headers.set("Authorization", `Bearer ${token}`);
  const workspaceId = request.cookies.get(KORYMB_WORKSPACE_COOKIE)?.value?.trim() || "";
  if (workspaceId) headers.set("X-Workspace-Id", workspaceId);
  // Ne pas fixer Content-Type : fetch pose le boundary multipart.

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("upstream timeout")), 90_000);
  let response: Response;
  try {
    response = await fetch(`${base}/business/resource-files`, {
      method: "POST",
      headers,
      body: outbound,
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
  const buf = await response.arrayBuffer();
  return new NextResponse(buf, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store",
    },
  });
}
