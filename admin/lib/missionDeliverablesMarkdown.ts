import type { Job, LatestChatFollowup } from "./types";

type Slice = {
  result?: string | null;
  team?: unknown;
  latest_chat_followup?: LatestChatFollowup | null;
};

/** Synthèse à analyser pour l’annexe livrables : follow-up chat terminé si présent, sinon résultat du job. */
export function deliverablesMarkdownFromJob(job: Slice | null | undefined): { markdown: string; team: unknown } {
  if (!job) return { markdown: "", team: null };
  const fb = job.latest_chat_followup;
  const fbOk =
    fb &&
    String(fb.status || "") === "completed" &&
    String(fb.result || "").trim().length > 0;
  if (fbOk && fb) {
    return { markdown: String(fb.result || ""), team: fb.team ?? job.team };
  }
  return { markdown: String(job.result || ""), team: job.team };
}

/**
 * Vue Missions (parent + dernier enfant + continuation live) : même logique que la carte synthèse.
 */
export function deliverablesMarkdownFromBossContext(
  detail: Job,
  latestChild: Job | undefined,
  cioResumeLiveId: string | null,
  cioResumeLive: Job | null | undefined,
): { markdown: string; team: unknown } {
  const liveD = cioResumeLiveId && cioResumeLive ? cioResumeLive : (latestChild ?? detail);
  const fb = detail.latest_chat_followup;
  const fbOk =
    fb &&
    String(fb.status || "") === "completed" &&
    String(fb.result || "").trim().length > 0;
  const liveSt = cioResumeLive ? String(cioResumeLive.status || "") : "";
  const liveHasResult =
    Boolean(cioResumeLiveId && cioResumeLive) &&
    liveSt === "completed" &&
    String(cioResumeLive?.result || "").trim().length > 0;

  let markdown = String(liveD.result || "") || String(detail.result || "");
  let team = liveD.team ?? detail.team;

  if (liveHasResult && cioResumeLive) {
    markdown = String(cioResumeLive.result || "");
    team = cioResumeLive.team ?? team;
  } else if (fbOk && fb && !cioResumeLiveId) {
    markdown = String(fb.result || "");
    team = fb.team ?? team;
  }
  return { markdown, team };
}
