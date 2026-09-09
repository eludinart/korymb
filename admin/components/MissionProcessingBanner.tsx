"use client";

import MissionStatusBadge from "./MissionStatusBadge";
import { missionStatusMeta } from "../lib/missionBossView";

type Props = {
  status?: string | null;
  executionLive?: boolean | null;
  agentHint?: string | null;
  /** Questions CIO / arbitrage en attente de réponse dirigeant. */
  awaitingDirectorResponse?: boolean;
  pendingQuestionCount?: number;
  className?: string;
};

type BannerKind = "processing" | "awaiting_you" | "hitl" | "done" | "quality" | "error" | "interrupted";

type BannerModel = {
  kind: BannerKind;
  title: string;
  message: string;
  shell: string;
  flag: string;
  /** Badge custom (sinon MissionStatusBadge). */
  badgeLabel?: string;
  badgeClassName?: string;
};

function resolveBanner(
  status?: string | null,
  executionLive?: boolean | null,
  opts?: { awaitingDirectorResponse?: boolean; pendingQuestionCount?: number },
): BannerModel | null {
  const s = String(status || "").toLowerCase();
  const meta = missionStatusMeta(status, { executionLive });
  const awaitingYou = Boolean(opts?.awaitingDirectorResponse);
  const qCount = Number(opts?.pendingQuestionCount || 0);

  // Priorité : votre réponse attendue (même si le job est encore "running").
  if (awaitingYou || s === "awaiting_validation") {
    if (s === "awaiting_validation") {
      return {
        kind: "hitl",
        title: "Les agents attendent votre validation",
        message:
          "Le traitement est en pause. Approuvez, amendez ou rejetez le plan / l’action ci-dessous pour que l’équipe reprenne.",
        shell: "border-violet-500 bg-gradient-to-r from-violet-50 via-violet-100/70 to-fuchsia-50 text-violet-950",
        flag: "bg-violet-600",
        badgeLabel: "À vous",
        badgeClassName: "bg-violet-700 text-white ring-2 ring-violet-300",
      };
    }
    const qLabel =
      qCount > 0
        ? `${qCount} question${qCount > 1 ? "s" : ""} en attente`
        : "précisions demandées";
    return {
      kind: "awaiting_you",
      title: "Les agents attendent votre réponse",
      message: `Le CIO a besoin de précisions (${qLabel}). Répondez dans « Arbitrages attendus » ou le panneau Précisions pour débloquer la suite.`,
      shell: "border-teal-500 bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50/80 text-teal-950",
      flag: "bg-teal-600",
      badgeLabel: "À vous",
      badgeClassName: "bg-teal-700 text-white ring-2 ring-teal-300",
    };
  }

  if ((s === "running" || s === "in_progress" || s === "pending") && executionLive === false) {
    return {
      kind: "interrupted",
      title: "Traitement interrompu",
      message:
        "Cette mission n’est plus exécutée en direct (processus arrêté ou serveur redémarré). Relancez une consigne au CIO ou clôturez-la.",
      shell: "border-slate-300 bg-slate-100 text-slate-950",
      flag: "bg-slate-500",
    };
  }

  if (s === "completed") {
    return {
      kind: "done",
      title: "Traitement terminé",
      message:
        "Les agents ont fini leur travail. Consultez la synthèse et les livrables ci-dessous, puis clôturez la mission si c’est bon pour vous.",
      shell: "border-emerald-400 bg-gradient-to-r from-emerald-50 via-white to-emerald-50/80 text-emerald-950",
      flag: "bg-emerald-500",
      badgeLabel: "Terminée",
      badgeClassName: "bg-emerald-700 text-white ring-2 ring-emerald-300",
    };
  }

  if (s === "running" || s === "in_progress") {
    return {
      kind: "processing",
      title: "Traitement en cours",
      message:
        "Les agents travaillent sur cette mission. Le résumé et les livrables se mettent à jour au fil de l’exécution — pas besoin de quitter cette page.",
      shell: "border-amber-400 bg-gradient-to-r from-amber-50 via-amber-100/80 to-orange-50 text-amber-950",
      flag: "bg-amber-500",
    };
  }
  if (s === "pending" || s === "accepted") {
    return {
      kind: "processing",
      title: "Mission démarrée — mise en file",
      message: "Le moteur a accepté la mission et prépare l’orchestration. Le statut passera à « en cours » sous peu.",
      shell: "border-sky-300 bg-sky-50 text-sky-950",
      flag: "bg-sky-500",
    };
  }
  if (s === "quality_blocked") {
    return {
      kind: "quality",
      title: "Contrôle qualité bloquant",
      message:
        "Un livrable n’a pas passé le seuil qualité. Consultez le diagnostic ou forcez la reprise si vous assumez le risque.",
      shell: "border-rose-400 bg-rose-50 text-rose-950",
      flag: "bg-rose-600",
    };
  }
  if (s.startsWith("error") || s === "failed") {
    return {
      kind: "error",
      title: "Mission en échec",
      message:
        meta.label !== "Erreur"
          ? `Statut : ${meta.label}. Vérifiez le diagnostic ou relancez via le CIO.`
          : "La mission s’est arrêtée sur une erreur. Consultez le diagnostic technique ou relancez via le CIO.",
      shell: "border-red-400 bg-red-50 text-red-950",
      flag: "bg-red-600",
    };
  }
  return null;
}

/**
 * Bandeau d’état en tête de mission : message clair + flag coloré (traitement, attente dirigeant, erreur…).
 */
export default function MissionProcessingBanner({
  status,
  executionLive,
  agentHint,
  awaitingDirectorResponse = false,
  pendingQuestionCount = 0,
  className = "",
}: Props) {
  const banner = resolveBanner(status, executionLive, {
    awaitingDirectorResponse,
    pendingQuestionCount,
  });
  if (!banner) return null;

  const pulsing = banner.kind === "processing";
  const waiting = banner.kind === "awaiting_you" || banner.kind === "hitl";

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex gap-3 rounded-2xl border-2 px-4 py-3 shadow-sm sm:items-start ${banner.shell} ${className}`}
    >
      <span className="relative mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center" aria-hidden>
        {pulsing ? (
          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-40 ${banner.flag}`} />
        ) : null}
        <span
          className={`relative inline-flex h-3.5 w-3.5 rounded-full ring-4 ring-white/70 ${banner.flag} ${
            waiting ? "animate-pulse" : ""
          }`}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-extrabold tracking-tight">{banner.title}</p>
          {banner.badgeLabel ? (
            <span
              className={`inline-flex items-center rounded-lg px-2.5 py-1 text-xs font-extrabold uppercase tracking-wide ${banner.badgeClassName || ""}`}
            >
              {banner.badgeLabel}
            </span>
          ) : (
            <MissionStatusBadge status={status} executionLive={executionLive} />
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed opacity-90">{banner.message}</p>
        {waiting ? (
          <p className="mt-1.5 text-xs font-semibold opacity-80">Action requise de votre part pour continuer.</p>
        ) : agentHint?.trim() ? (
          <p className="mt-1.5 text-xs font-semibold opacity-80">Agent actif : {agentHint.trim()}</p>
        ) : null}
      </div>
    </div>
  );
}
