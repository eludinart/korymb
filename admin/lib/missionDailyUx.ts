/**
 * UX quotidien des missions — phases, origine, CTA primaire.
 * Aligné sur Décisions (action_kind / hitl) sans inventer d’états.
 */

import { missionTitleLabel } from "./missionLabel";
import { normalizeJobId } from "./missionBossView";

export type MissionPhaseId = "running" | "decide" | "act" | "ready" | "done" | "error";

export type MissionOriginId = "studio" | "playbook" | "libre" | "chat";

export type InboxHint = {
  kind?: string;
  job_id?: string;
  ticket_id?: string;
  action_kind?: string;
  hitl_kind?: string;
  primary_cta?: string;
  title?: string;
};

export type MissionPrimaryAction =
  | { type: "approve_ticket"; label: string; ticketId: string; actionKind: string }
  | { type: "open_decide"; label: string }
  | { type: "finish"; label: string }
  | { type: "open_href"; label: string; href: string }
  | { type: "none"; label: string };

type JobLike = {
  job_id?: string;
  mission?: string | null;
  status?: string | null;
  source?: string | null;
  user_validated_at?: string | null;
  mission_closed_by_user?: boolean;
  execution_live?: boolean | null;
  hitl?: { gate?: { kind?: string } } | null;
  hitl_gate?: { kind?: string; gate?: { kind?: string } } | null;
};

export function missionOrigin(source?: string | null): { id: MissionOriginId; label: string } {
  const s = String(source || "mission").toLowerCase();
  if (s.startsWith("studio:")) return { id: "studio", label: "Studio" };
  if (s.startsWith("playbook:")) return { id: "playbook", label: "Playbook" };
  if (s.startsWith("chat")) return { id: "chat", label: "Chat" };
  return { id: "libre", label: "Libre" };
}

export function missionPhase(
  job: JobLike,
  opts?: { hasPendingQuestions?: boolean; hasActionTicket?: boolean },
): { id: MissionPhaseId; label: string } {
  const st = String(job.status || "").toLowerCase();
  const closed = Boolean(job.user_validated_at || job.mission_closed_by_user);

  if (closed) return { id: "done", label: "Terminé" };
  if (st.startsWith("error") || st === "failed") return { id: "error", label: "Échec" };
  if (st === "cancelled") return { id: "done", label: "Interrompu" };

  if (opts?.hasActionTicket) return { id: "act", label: "Prêt à agir" };
  if (st === "awaiting_validation" || opts?.hasPendingQuestions) {
    return { id: "decide", label: "À décider" };
  }

  const live =
    job.execution_live !== false &&
    (st === "running" || st === "in_progress" || st === "pending" || st === "accepted");
  if (live) return { id: "running", label: "En cours" };

  if (st === "completed") return { id: "ready", label: "Prêt à terminer" };

  return { id: "running", label: "En cours" };
}

export function phaseBadgeClass(phase: MissionPhaseId): string {
  switch (phase) {
    case "running":
      return "bg-amber-100 text-amber-950 ring-1 ring-amber-200";
    case "decide":
      return "bg-violet-200 text-violet-950 ring-1 ring-violet-300";
    case "act":
      return "bg-emerald-100 text-emerald-950 ring-1 ring-emerald-300";
    case "ready":
      return "bg-slate-100 text-slate-800 ring-1 ring-slate-200";
    case "done":
      return "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-100";
    case "error":
      return "bg-red-100 text-red-950 ring-1 ring-red-200";
    default:
      return "bg-slate-100 text-slate-700 ring-1 ring-slate-200";
  }
}

export function originBadgeClass(origin: MissionOriginId): string {
  switch (origin) {
    case "studio":
      return "bg-fuchsia-50 text-fuchsia-900 ring-1 ring-fuchsia-200";
    case "playbook":
      return "bg-sky-50 text-sky-900 ring-1 ring-sky-200";
    case "chat":
      return "bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200";
    default:
      return "bg-slate-50 text-slate-600 ring-1 ring-slate-200";
  }
}

function hitlKind(job: JobLike): string {
  const fromDetail = job.hitl?.gate?.kind;
  if (fromDetail) return String(fromDetail);
  const gate = job.hitl_gate;
  if (gate && typeof gate === "object") {
    if (gate.kind) return String(gate.kind);
    if (gate.gate?.kind) return String(gate.gate.kind);
  }
  return "";
}

export function ticketActionLabel(actionKind: string, primaryCta?: string): string {
  if (primaryCta?.trim()) return primaryCta.trim();
  const k = String(actionKind || "").toLowerCase();
  if (k === "calendar") return "Mettre à l’agenda";
  if (k === "wordpress" || k === "social") return "Publier";
  if (k === "email") return "Envoyer";
  return "Valider l’action";
}

export function inboxItemsForJob(items: InboxHint[] | undefined, jobId: string): InboxHint[] {
  const id = normalizeJobId(jobId);
  if (!id || !items?.length) return [];
  return items.filter((it) => normalizeJobId(it.job_id) === id);
}

/** CTA primaire pour liste / panneau — ordre : Agir → Décider → Studio → Terminer. */
export function resolveMissionPrimaryAction(
  job: JobLike,
  inboxItems?: InboxHint[],
): MissionPrimaryAction {
  const st = String(job.status || "").toLowerCase();
  const closed = Boolean(job.user_validated_at || job.mission_closed_by_user);
  const origin = missionOrigin(job.source);
  const items = inboxItemsForJob(inboxItems, String(job.job_id || ""));

  if (closed) return { type: "none", label: "Terminé" };

  const ticket = items.find((i) => i.kind === "action_ticket" && i.ticket_id);
  if (ticket?.ticket_id) {
    return {
      type: "approve_ticket",
      label: ticketActionLabel(String(ticket.action_kind || ""), ticket.primary_cta),
      ticketId: String(ticket.ticket_id),
      actionKind: String(ticket.action_kind || ""),
    };
  }

  if (st === "awaiting_validation") {
    const hk = hitlKind(job) || items.find((i) => i.kind === "hitl")?.hitl_kind || "";
    if (hk === "cio_plan") return { type: "open_decide", label: "Valider le plan" };
    return { type: "open_decide", label: "Décider" };
  }

  if (items.some((i) => i.kind === "cio_question" || i.kind === "hitl")) {
    return { type: "open_decide", label: "Décider" };
  }

  if (origin.id === "studio" && (st === "completed" || st === "awaiting_validation")) {
    return { type: "open_href", label: "Ouvrir le Studio", href: "/gestion/studio" };
  }

  if (st === "completed") {
    return { type: "finish", label: "Terminer" };
  }

  if (st.startsWith("error") || st === "failed") {
    return { type: "open_decide", label: "Voir l’échec" };
  }

  return { type: "none", label: "Voir" };
}

export function missionCardTitle(mission?: string | null, max = 72): string {
  return missionTitleLabel(mission, max) || "Mission sans titre";
}

export function decisionsHrefForJob(jobId: string): string {
  return `/inbox?job=${encodeURIComponent(normalizeJobId(jobId))}`;
}
