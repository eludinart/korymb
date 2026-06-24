import { eventPayload } from "./missionEvents";

type ThreadMsg = { content?: string; source?: string };

/** Réponses dirigeant indexées par libellé exact de question. */
export function collectCioArbitrageAnswers(
  events: Array<Record<string, unknown>> | undefined,
  missionThread?: ThreadMsg[] | null,
): Record<string, string> {
  const out: Record<string, string> = {};

  for (const ev of events || []) {
    if (ev.type === "cio_arbitrage_answer") {
      const pl = eventPayload(ev);
      const q = String(pl.question || "").trim();
      const a = String(pl.answer || "").trim();
      if (q && a) out[q] = a;
      continue;
    }
    if (ev.type === "cio_question") {
      const pl = eventPayload(ev);
      const qa = pl.question_answers;
      if (qa && typeof qa === "object" && !Array.isArray(qa)) {
        for (const [q, a] of Object.entries(qa as Record<string, unknown>)) {
          const qq = String(q).trim();
          const aa = String(a).trim();
          if (qq && aa) out[qq] = aa;
        }
      }
    }
  }

  for (const msg of missionThread || []) {
    const content = String(msg.content || "");
    if (!content.includes("[Réponse arbitrage CIO]")) continue;
    const qMatch = content.match(/Question\s*:\s*([\s\S]*?)\nRéponse\s*:/i);
    const aMatch = content.match(/Réponse\s*:\s*([\s\S]*)$/i);
    const q = qMatch?.[1]?.trim();
    const a = aMatch?.[1]?.trim();
    if (q && a) out[q] = a;
  }

  return out;
}

export function countPendingArbitrageQuestions(
  questions: string[],
  answers: Record<string, string>,
): number {
  return questions.filter((q) => !answers[q.trim()]?.trim()).length;
}
