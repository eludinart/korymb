import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "./api";

function isGenericRoute404(status: number, data: unknown): boolean {
  if (status !== 404) return false;
  const msg = formatHttpApiErrorPayload(data).trim();
  if (!msg) return true;
  return /^not found$/i.test(msg);
}

function isLegacyRunMissingSessionDelete(status: number, data: unknown): boolean {
  if (status !== 400) return false;
  return /^mission vide\.?$/i.test(formatHttpApiErrorPayload(data).trim());
}

/** Supprime une session de mission guidée (plusieurs chemins API pour compatibilité backend). */
export async function deleteMissionSession(sessionId: string): Promise<void> {
  const id = sessionId.trim();
  if (!id) throw new Error("Identifiant de session manquant.");
  const headers = agentHeaders();
  const attempts = [
    () =>
      requestJson(`/mission-sessions/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers,
        expectOk: false,
      }),
    () =>
      requestJson(`/mission-sessions/${encodeURIComponent(id)}/remove`, {
        method: "POST",
        headers,
        body: "{}",
        expectOk: false,
      }),
    () =>
      requestJson("/run", {
        method: "POST",
        headers,
        body: JSON.stringify({ mission: "", remove_mission_session_id: id }),
        expectOk: false,
      }),
    () =>
      requestJson("/run/remove-mission-session", {
        method: "POST",
        headers,
        body: JSON.stringify({ session_id: id }),
        expectOk: false,
      }),
  ];

  let last: { res: Response; data: unknown } | null = null;
  for (const call of attempts) {
    const out = await call();
    last = out;
    if (out.res.ok) return;
    if (out.res.status === 405) continue;
    if (out.res.status === 404 && isGenericRoute404(out.res.status, out.data)) continue;
    if (isLegacyRunMissingSessionDelete(out.res.status, out.data)) continue;
    throw new Error(formatHttpApiErrorPayload(out.data) || `Suppression session: HTTP ${out.res.status}`);
  }
  throw new Error(
    formatHttpApiErrorPayload(last?.data) ||
      "Suppression session : le backend ne répond sur aucun chemin de suppression.",
  );
}
