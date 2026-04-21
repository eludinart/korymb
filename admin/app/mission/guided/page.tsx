"use client";

import { FormEvent, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import CioResultPanel from "../../../components/CioResultPanel";
import LiveAgentInteractionStrip from "../../../components/LiveAgentInteractionStrip";
import MissionMetricsRow from "../../../components/MissionMetricsRow";
import SessionCadrageTimeline from "../../../components/SessionCadrageTimeline";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "../../../lib/api";
import { clampRefinementRounds, DEFAULT_REFINEMENT_ROUNDS, MAX_REFINEMENT_ROUNDS } from "../../../lib/missionRefinement";
import { QK } from "../../../lib/queryClient";

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

function sessionDeleteErrorUserMessage(raw: string): string {
  const t = raw.trim();
  if (/^not found$/i.test(t) || /aucun des chemins|redémarrer le serveur fastapi/i.test(t)) {
    return (
      "Suppression impossible : le FastAPI sur le port configuré (souvent 8020) tourne encore avec une ancienne version du code " +
      "(toutes les routes de suppression renvoient 404/405 ; POST /run ignore encore remove_mission_session_id). " +
      "Arrête complètement le job backend (Ctrl+C sur start-dev-cursor), puis depuis le dossier backend lance : " +
      "`.\\restart.ps1` — le script efface maintenant `backend\\__pycache__` et fixe `--reload-dir`. " +
      "Vérifie ensuite `GET http://127.0.0.1:8020/health` : la clé JSON `mission_session_delete_routes` doit apparaître."
    );
  }
  return raw;
}

export default function MissionGuidedPage() {
  const qc = useQueryClient();
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Job renvoyé par validate (avant que `linked_job_id` soit reflété dans le détail session). */
  const [trackingJobId, setTrackingJobId] = useState("");
  const [agent, setAgent] = useState("coordinateur");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [busy, setBusy] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
  const [refinementEnabled, setRefinementEnabled] = useState(false);
  const [refinementRounds, setRefinementRounds] = useState(DEFAULT_REFINEMENT_ROUNDS);
  /** Formulaire « Nouvelle session » : visible seulement après action explicite (bouton en-tête). */
  const [showNewSessionForm, setShowNewSessionForm] = useState(false);

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });
  const sessions = useQuery({
    queryKey: QK.missionSessions,
    queryFn: async () => (await requestJson("/mission-sessions", { headers: agentHeaders(), retries: 1 })).data.sessions || [],
    refetchInterval: () => visibleInterval(5000),
  });

  const sessionDetail = useQuery({
    queryKey: ["mission-session-detail", sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () =>
      (
        await requestJson(`/mission-sessions/${encodeURIComponent(String(sessionId))}`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
    refetchInterval: () => (sessionId ? visibleInterval(3000) : false),
  });

  const effectiveJobId = String(sessionDetail.data?.linked_job_id || trackingJobId || "");

  const jobLive = useQuery({
    queryKey: ["job-live", effectiveJobId],
    enabled: Boolean(effectiveJobId),
    queryFn: async () =>
      (
        await requestJson(`/jobs/${encodeURIComponent(effectiveJobId)}?log_offset=0&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
    refetchInterval: (q) => {
      if (!effectiveJobId || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      const st = String((q.state.data as { status?: string } | undefined)?.status || "");
      return st === "running" ? 650 : 2200;
    },
  });

  const agentLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of (agents.data || []) as { key: string; label: string }[]) {
      if (a?.key) m[a.key] = a.label || a.key;
    }
    return m;
  }, [agents.data]);

  const lastUserCadrage = useMemo(() => {
    const list = Array.isArray(sessionDetail.data?.messages) ? (sessionDetail.data.messages as { role?: string; content?: string }[]) : [];
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (String(list[i]?.role || "") === "user" && String(list[i]?.content || "").trim()) {
        return String(list[i].content).trim();
      }
    }
    return "";
  }, [sessionDetail.data?.messages]);

  const createSession = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const { data } = await requestJson("/mission-sessions", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ agent, title: title.trim() || null }),
      });
      setShowNewSessionForm(false);
      setSessionId(data.id);
      setTrackingJobId("");
      setTitle("");
      qc.invalidateQueries({ queryKey: QK.missionSessions });
      qc.invalidateQueries({ queryKey: ["mission-session-detail", data.id] });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const sendMessage = async (e: FormEvent) => {
    e.preventDefault();
    if (!sessionId || !message.trim()) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      await requestJson(`/mission-sessions/${sessionId}/message`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ message: message.trim() }),
      });
      setMessage("");
      qc.invalidateQueries({ queryKey: QK.missionSessions });
      if (sessionId) qc.invalidateQueries({ queryKey: ["mission-session-detail", sessionId] });
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const sessionStatus = String(sessionDetail.data?.status || "");
  const canValidate = Boolean(sessionId) && sessionStatus === "draft";

  const deleteSession = async (id: string) => {
    if (typeof window !== "undefined") {
      const okConfirm = window.confirm(
        "Supprimer cette session de cadrage ? Les missions déjà lancées restent visibles dans l’historique des jobs.",
      );
      if (!okConfirm) return;
    }
    setDeletingSessionId(id);
    setErr("");
    setOk("");
    try {
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
      const isGenericRoute404 = (status: number, data: unknown) => {
        if (status !== 404) return false;
        const msg = formatHttpApiErrorPayload(data).trim();
        if (!msg) return true;
        return /^not found$/i.test(msg);
      };
      /** Ancien backend : POST /run sans champ remove_mission_session_id → 400 Mission vide. */
      const isLegacyRunMissingSessionDelete = (status: number, data: unknown) => {
        if (status !== 400) return false;
        return /^mission vide\.?$/i.test(formatHttpApiErrorPayload(data).trim());
      };
      let last: { res: Response; data: unknown } | null = null;
      for (const call of attempts) {
        const out = await call();
        last = out;
        if (out.res.ok) break;
        if (out.res.status === 405) continue;
        if (out.res.status === 404 && isGenericRoute404(out.res.status, out.data)) continue;
        if (isLegacyRunMissingSessionDelete(out.res.status, out.data)) continue;
        throw new Error(formatHttpApiErrorPayload(out.data) || `Suppression session: HTTP ${out.res.status}`);
      }
      if (!last?.res.ok) {
        throw new Error(
          formatHttpApiErrorPayload(last?.data) ||
            "Suppression session: le backend ne répond sur aucun des chemins de suppression (redémarrer le serveur FastAPI).",
        );
      }
      if (sessionId === id) {
        setSessionId(null);
        setTrackingJobId("");
        setShowNewSessionForm(false);
      }
      setOk("Session supprimée.");
      await qc.invalidateQueries({ queryKey: QK.missionSessions });
      qc.removeQueries({ queryKey: ["mission-session-detail", id] });
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      setErr(sessionDeleteErrorUserMessage(raw));
    } finally {
      setDeletingSessionId(null);
    }
  };

  const validateSession = async () => {
    if (!sessionId) return;
    setBusy(true);
    setErr("");
    setOk("");
    try {
      const rounds = clampRefinementRounds(refinementRounds);
      const body: { mission_config?: { recursive_refinement_enabled: boolean; recursive_max_rounds: number } } = {};
      if (refinementEnabled) {
        body.mission_config = { recursive_refinement_enabled: true, recursive_max_rounds: rounds };
      }
      const { data } = await requestJson(`/mission-sessions/${sessionId}/validate`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      });
      qc.invalidateQueries({ queryKey: QK.missionSessions });
      qc.invalidateQueries({ queryKey: ["mission-session-detail", sessionId] });
      qc.invalidateQueries({ queryKey: QK.jobs });
      qc.invalidateQueries({ queryKey: QK.tokens });
      const jobId = String(data?.job_id || "");
      if (jobId) setTrackingJobId(jobId);
      setOk(jobId ? `Mission validée et lancée (#${jobId}). Le déroulé des agents s’affiche ci-dessous.` : "Mission validée et lancée.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const openNewSessionForm = () => {
    setErr("");
    setOk("");
    setMessage("");
    setShowNewSessionForm(true);
    setSessionId(null);
    setTrackingJobId("");
  };

  const closeNewSessionForm = () => {
    setShowNewSessionForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mission guidée</h1>
          <p className="text-sm text-slate-500 mt-1">Cadrage avec le coordinateur, puis lancement de la mission.</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          {showNewSessionForm ? (
            <button
              type="button"
              onClick={closeNewSessionForm}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
            >
              Fermer le formulaire de création
            </button>
          ) : (
            <button
              type="button"
              onClick={openNewSessionForm}
              className="rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-violet-800"
            >
              Créer une nouvelle mission guidée
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs uppercase tracking-wide text-slate-400 mb-2">Sessions</p>
          <ul className="space-y-2 max-h-[420px] overflow-y-auto">
            {(sessions.data || []).map((s: { id: string; title?: string; agent?: string; status?: string }) => (
              <li key={s.id}>
                <div
                  className={`flex min-w-0 rounded-lg border text-xs ${
                    sessionId === s.id ? "border-violet-500 bg-violet-50" : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewSessionForm(false);
                      setSessionId(s.id);
                      setTrackingJobId("");
                    }}
                    className="min-w-0 flex-1 px-2 py-2 text-left"
                  >
                    <p className="font-mono text-slate-500">#{s.id}</p>
                    <p className="font-medium text-slate-800">{s.title || s.agent}</p>
                    <p className="text-slate-500">{s.status}</p>
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(deletingSessionId)}
                    aria-label="Supprimer cette session"
                    onClick={(e) => {
                      e.preventDefault();
                      void deleteSession(s.id);
                    }}
                    className={`shrink-0 self-stretch border-l px-2 text-[11px] font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 ${
                      sessionId === s.id ? "border-violet-200" : "border-slate-200"
                    }`}
                  >
                    {deletingSessionId === s.id ? "…" : "Supprimer"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </aside>

        <div className="space-y-4">
          {err ? <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p> : null}
          {ok ? <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">{ok}</p> : null}
          {!sessionId && !showNewSessionForm ? (
            <p className="text-sm text-slate-600 bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
              Sélectionnez une session dans la liste à gauche pour consulter le cadrage et le suivi, ou utilisez le bouton{" "}
              <span className="font-semibold text-slate-800">Créer une nouvelle mission guidée</span> pour ouvrir le formulaire
              de création.
            </p>
          ) : null}
          {sessionId && sessionDetail.isLoading ? <p className="text-sm text-slate-400">Chargement session...</p> : null}
          {sessionId && sessionDetail.isSuccess ? (
            <SessionCadrageTimeline messages={sessionDetail.data?.messages} maxHeightClass="max-h-96" />
          ) : null}
          {sessionId && effectiveJobId ? (
            <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="text-sm font-semibold text-slate-900">Exécution mission · #{effectiveJobId}</p>
                <Link
                  href={`/missions?job=${encodeURIComponent(effectiveJobId)}`}
                  className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-900 hover:bg-violet-100"
                >
                  Panneau mission complet
                </Link>
              </div>
              <p className="text-xs text-slate-500">
                Statut : {String(jobLive.data?.status || (jobLive.isLoading ? "…" : "—"))}
                {jobLive.isError ? <span className="ml-2 text-red-600">Erreur de chargement du suivi.</span> : null}
              </p>
              {lastUserCadrage ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Dernier message de cadrage (vous)</p>
                  <p className="mt-1 text-sm leading-relaxed text-slate-800">{lastUserCadrage}</p>
                </div>
              ) : null}
              {jobLive.data ? (
                <>
                  <LiveAgentInteractionStrip events={jobLive.data.events} agentLabelMap={agentLabelMap} />
                  <CioResultPanel
                    result={jobLive.data.result}
                    missionTitle={jobLive.data.mission}
                    jobLine={`#${jobLive.data.job_id} · ${jobLive.data.agent} · ${jobLive.data.status}`}
                  />
                  <MissionMetricsRow
                    status={jobLive.data.status}
                    tokensTotal={Number(jobLive.data.tokens_total || 0)}
                    costUsd={Number(jobLive.data.cost_usd ?? 0)}
                    eventsTotal={Number(jobLive.data.events_total || 0)}
                    logTotal={Number(jobLive.data.log_total || 0)}
                  />
                </>
              ) : jobLive.isLoading ? (
                <p className="text-sm text-slate-400">Chargement du déroulé agents…</p>
              ) : null}
            </section>
          ) : null}
          {showNewSessionForm ? (
            <form onSubmit={createSession} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
              <p className="text-sm font-semibold">Nouvelle session</p>
              <select value={agent} onChange={(e) => setAgent(e.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
                {(agents.data || []).map((a: { key: string; label: string }) => (
                  <option key={a.key} value={a.key}>{a.label}</option>
                ))}
              </select>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titre optionnel" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
              <button disabled={busy} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40">
                {busy ? "Création…" : "Créer"}
              </button>
            </form>
          ) : null}

          {sessionId ? (
            <>
              <form onSubmit={sendMessage} className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <p className="text-sm font-semibold">Message de cadrage</p>
                <textarea
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder={
                    sessionStatus === "draft"
                      ? "Message pour affiner la mission…"
                      : "Session figée : crée une nouvelle mission guidée pour un nouveau cadrage."
                  }
                  disabled={sessionStatus !== "draft"}
                />
                <button
                  disabled={busy || sessionStatus !== "draft" || !message.trim()}
                  className="bg-violet-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40"
                >
                  {busy ? "Envoi…" : "Envoyer"}
                </button>
              </form>
              <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
                <p className="text-sm font-semibold">Validation de la mission</p>
                <p className="text-xs text-slate-500">
                  Une fois le cadrage terminé, valide la session pour créer la mission exécutable. Statut session:{" "}
                  <span className="font-mono">{sessionStatus || "—"}</span>
                </p>
                <fieldset className="rounded-lg border border-amber-100 bg-amber-50/40 px-3 py-2">
                  <legend className="px-1 text-[11px] font-semibold text-amber-950">Boucle d&apos;exécution au lancement</legend>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-amber-900/80">Boucle d&apos;affinage CIO</p>
                  <label className="flex cursor-pointer items-start gap-2 text-xs text-slate-800">
                    <input
                      type="checkbox"
                      checked={refinementEnabled}
                      onChange={(e) => setRefinementEnabled(e.target.checked)}
                      disabled={sessionStatus !== "draft"}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-slate-300 disabled:opacity-40"
                    />
                    <span className="leading-relaxed">
                      Activer jusqu&apos;à{" "}
                      {refinementEnabled ? (
                        <span className="inline-flex items-center gap-0.5 align-middle">
                          <input
                            id="guided-refine-rounds"
                            type="number"
                            min={1}
                            max={MAX_REFINEMENT_ROUNDS}
                            value={refinementRounds}
                            onChange={(e) => setRefinementRounds(clampRefinementRounds(e.target.value))}
                            disabled={sessionStatus !== "draft"}
                            className="w-14 rounded border border-amber-200/80 bg-white px-1 py-0.5 text-center text-xs font-semibold tabular-nums text-amber-950 disabled:opacity-40"
                          />
                          <span className="font-semibold">tours</span>
                        </span>
                      ) : (
                        <strong>
                          {refinementRounds} tour{refinementRounds > 1 ? "s" : ""}
                        </strong>
                      )}{" "}
                      de <strong>boucle d&apos;exécution</strong> (critique → replan → sous-agents), plafond{" "}
                      {MAX_REFINEMENT_ROUNDS} — coûteux en tokens.
                    </span>
                  </label>
                </fieldset>
                <button
                  type="button"
                  onClick={() => void validateSession()}
                  disabled={busy || !canValidate}
                  className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm disabled:opacity-40"
                >
                  {busy ? "Validation…" : "Valider et lancer"}
                </button>
                {!canValidate && sessionId && sessionStatus && sessionStatus !== "draft" ? (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5">
                    Cette session n&apos;est plus en brouillon (statut: {sessionStatus}). Utilisez{" "}
                    <span className="font-semibold">Créer une nouvelle mission guidée</span> pour un nouveau cadrage.
                  </p>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
