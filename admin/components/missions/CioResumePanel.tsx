"use client";

import { type FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { agentHeaders, requestJson } from "../../lib/api";
import { canResumeMissionCio } from "../../lib/missionThreadPending";

type Props = {
  jobId: string;
  jobStatus: string;
  missionClosed?: boolean;
  hasPendingCioTurn?: boolean;
  /** Compact : sous le fil ; full : rail latéral. */
  variant?: "compact" | "full";
  onLiveJobIdChange?: (liveId: string | null) => void;
  liveJobId?: string | null;
  className?: string;
};

export default function CioResumePanel({
  jobId,
  jobStatus,
  missionClosed = false,
  hasPendingCioTurn = false,
  variant = "full",
  onLiveJobIdChange,
  liveJobId = null,
  className = "",
}: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cioQuestionsEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("cio_questions_enabled") !== "false";
  });

  const st = String(jobStatus || "").toLowerCase();
  const canResume = Boolean(jobId) && canResumeMissionCio(st, missionClosed, hasPendingCioTurn);

  useEffect(() => {
    setInput("");
    setBusy(false);
    setError("");
  }, [jobId]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!jobId || !input.trim() || busy || liveJobId) return;
    setBusy(true);
    setError("");
    try {
      const { data } = await requestJson("/chat", {
        method: "POST",
        headers: agentHeaders(),
        timeoutMs: 20_000,
        body: JSON.stringify({
          message: input.trim(),
          agent: "coordinateur",
          history: [],
          linked_job_id: jobId,
          mission_config: { cio_questions_enabled: cioQuestionsEnabled },
        }),
      });
      setInput("");
      if (data?.status === "accepted" && data?.job_id) {
        onLiveJobIdChange?.(String(data.job_id));
      } else {
        setError("Réponse chat inattendue (pas de job_id).");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!canResume) return null;

  if (liveJobId) {
    return (
      <div className={`flex items-center gap-2 border-t border-violet-100 bg-violet-50/80 px-3 py-3 ${className}`}>
        <span className="h-2 w-2 animate-pulse rounded-full bg-violet-500" />
        <p className="text-xs text-violet-800">Tour en cours — le formulaire revient à la fin du tour.</p>
      </div>
    );
  }

  const compact = variant === "compact";

  return (
    <form
      onSubmit={(e) => void onSubmit(e)}
      className={`border-t border-violet-200 bg-violet-50/90 ${compact ? "space-y-2 p-3" : "space-y-2 p-3"} ${className}`}
    >
      {st === "running" ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-950" role="status">
          Mission « en cours » — faites défiler le fil ci-dessus, puis envoyez une consigne pour relancer le CIO.
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={`cio-resume-${jobId}`} className="text-xs font-semibold text-slate-900">
          Discuter avec le CIO — consigne pour la suite
        </label>
        <Link
          href={`/chat?parent=${encodeURIComponent(jobId)}`}
          className="shrink-0 rounded-lg bg-violet-100 px-2 py-1 text-[10px] font-semibold text-violet-800 hover:bg-violet-200"
        >
          Chat
        </Link>
      </div>
      <textarea
        id={`cio-resume-${jobId}`}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={busy}
        rows={compact ? 2 : 3}
        className="w-full resize-y rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-snug text-slate-900 outline-none ring-violet-200 focus:border-violet-400 focus:ring-1 disabled:opacity-50"
        placeholder="Ex. : Ducoup en euros, j'ai besoin d'un exemple chiffré pour…"
      />
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <button
        type="submit"
        disabled={busy || !input.trim()}
        className="w-full rounded-xl bg-violet-700 px-3 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:opacity-40"
      >
        {busy ? "Envoi…" : "Envoyer au CIO"}
      </button>
    </form>
  );
}
