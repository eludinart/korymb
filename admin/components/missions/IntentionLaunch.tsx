"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { agentHeaders, requestJson } from "../../lib/api";
import { useActionToast } from "../../lib/actionToast";
import { missionTitleLabel } from "../../lib/missionLabel";
import { loadThinkingMode, type ThinkingModeId } from "../../lib/thinkingMode";
import ThinkingModePicker from "../director/ThinkingModePicker";

type Props = {
  className?: string;
  compact?: boolean;
  showThinkingMode?: boolean;
};

/** Lancement d'intention en une phrase — sans jargon job / HITL. */
export default function IntentionLaunch({
  className = "",
  compact = false,
  showThinkingMode = true,
}: Props) {
  const router = useRouter();
  const { pushToast } = useActionToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [thinkingMode, setThinkingMode] = useState<ThinkingModeId>("auto");

  useEffect(() => {
    setThinkingMode(loadThinkingMode());
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const intention = text.trim();
    if (!intention || busy) return;
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          mission: intention,
          agent: "coordinateur",
          mission_config: {
            agent_group_id: "entreprise",
            orchestrator_key: "coordinateur",
            thinking_mode: thinkingMode,
          },
        }),
        timeoutMs: 20_000,
      });
      const jobId = String((data as { job_id?: string })?.job_id || "");
      setText("");
      const okMsg = jobId
        ? `Mission lancée : « ${missionTitleLabel(intention, 60) || jobId} »`
        : "Demande acceptée.";
      setMsg(okMsg);
      pushToast(okMsg);
      if (jobId) {
        router.push(`/missions?job=${encodeURIComponent(jobId)}`);
      }
    } catch (ex) {
      const errMsg = ex instanceof Error ? ex.message : String(ex);
      setErr(errMsg);
      pushToast(errMsg, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={`space-y-2 ${className}`}>
      {showThinkingMode ? (
        <ThinkingModePicker value={thinkingMode} onChange={setThinkingMode} persist compact={compact} />
      ) : null}
      <label htmlFor="intention-launch" className="sr-only">
        Que voulez-vous accomplir ?
      </label>
      <textarea
        id="intention-launch"
        rows={compact ? 2 : 3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
        className="field-input leading-relaxed"
        placeholder="Ex. : préparer un brief pour le client X, style court et concret…"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy || !text.trim()} className="btn-primary">
          {busy ? "Lancement…" : "Lancer"}
        </button>
        {msg ? (
          <p className="text-sm text-emerald-800" role="status">
            {msg}
          </p>
        ) : null}
        {err ? (
          <p className="text-sm font-semibold text-red-700" role="alert">
            {err}
          </p>
        ) : null}
      </div>
    </form>
  );
}
