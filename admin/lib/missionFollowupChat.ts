/** Convertit `mission_thread` (API jobs) en historique attendu par POST /chat. */

type ThreadEntry = { role?: string; content?: string; agent?: string };

/** Aligné sur le plafond serveur `MISSION_THREAD_CONTENT_MAX_CHARS` (database.py). */
const THREAD_CONTENT_CAP = 250_000;

export function missionThreadToChatHistory(thread: unknown, maxMessages = 20): { role: "user" | "assistant"; content: string }[] {
  const list = Array.isArray(thread) ? (thread as ThreadEntry[]) : [];
  const out: { role: "user" | "assistant"; content: string }[] = [];
  const slice = list.slice(-maxMessages);
  for (const m of slice) {
    const r = String(m.role || "").toLowerCase();
    const c = String(m.content || "").trim();
    if (!c) continue;
    if (r === "user") out.push({ role: "user", content: c.slice(0, THREAD_CONTENT_CAP) });
    else if (r === "assistant") out.push({ role: "assistant", content: c.slice(0, THREAD_CONTENT_CAP) });
  }
  return out;
}
