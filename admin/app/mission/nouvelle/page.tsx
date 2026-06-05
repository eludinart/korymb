"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import MissionJobLiveDetail from "../../../components/MissionJobLiveDetail";
import { agentHeaders, requestJson } from "../../../lib/api";
import { clampRefinementRounds, DEFAULT_REFINEMENT_ROUNDS, MAX_REFINEMENT_ROUNDS } from "../../../lib/missionRefinement";
import { QK } from "../../../lib/queryClient";
import { PageHeader, PageShell } from "../../../components/ui/PageChrome";

import type { JobRow } from "../../../lib/types";

const ACTIVE = new Set(["running", "pending"]);

export default function MissionNouvellePage() {
  const qc = useQueryClient();
  const [mission, setMission] = useState("");
  const [agent, setAgent] = useState("coordinateur");
  const [refinementEnabled, setRefinementEnabled] = useState(false);
  const [refinementRounds, setRefinementRounds] = useState(DEFAULT_REFINEMENT_ROUNDS);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [jobId, setJobId] = useState("");
  /** Si coché : pas de pause HITL sur le plan CIO (délégation immédiate). */
  const [skipPlanHitl, setSkipPlanHitl] = useState(false);
  /** Consigne affichée au-dessus du fil d’exécution (la textarea est vidée après lancement). */
  const [lastMissionPrompt, setLastMissionPrompt] = useState("");
  const [mobilePane, setMobilePane] = useState<"liste" | "suivi">("suivi");
  const [costEst, setCostEst] = useState<{ estimated_cost_usd?: number; tier?: string; warnings?: string[] } | null>(null);
  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });
  const jobsList = useQuery({
    queryKey: QK.jobsCards,
    queryFn: async () =>
      (await requestJson("/jobs/cards", { headers: agentHeaders(), retries: 1, timeoutMs: 30_000 })).data.jobs || [],
    staleTime: 15_000,
    refetchInterval: (query) => {
      if (typeof document === "undefined" || document.visibilityState !== "visible") return false;
      if (query.state.fetchStatus === "fetching") return false;
      return 10_000;
    },
  });
  const jobLive = useQuery({
    queryKey: ["job-live", jobId],
    enabled: Boolean(jobId),
    queryFn: async () =>
      (
        await requestJson(`/jobs/${encodeURIComponent(jobId)}?log_offset=0&events_offset=0`, {
          headers: agentHeaders(),
          retries: 1,
        })
      ).data,
    refetchInterval: (q) => {
      if (!jobId || typeof document === "undefined" || document.visibilityState !== "visible") return false;
      const st = String((q.state.data as { status?: string } | undefined)?.status || "");
      return st === "running" || st === "pending" || st === "awaiting_validation" ? 650 : 2200;
    },
  });

  const agentLabelMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of (agents.data || []) as { key: string; label: string }[]) {
      if (a?.key) m[a.key] = a.label || a.key;
    }
    return m;
  }, [agents.data]);

  const runningJobs = useMemo(() => {
    const rows = (jobsList.data || []) as JobRow[];
    return rows.filter((j) => ACTIVE.has(String(j.status || "").toLowerCase()));
  }, [jobsList.data]);

  const pickRunningJob = (j: JobRow) => {
    setJobId(String(j.job_id));
    setLastMissionPrompt(String(j.mission || "").trim());
    setMsg("");
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobilePane("suivi");
    }
  };

  useEffect(() => {
    if (jobId && typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setMobilePane("suivi");
    }
  }, [jobId]);

  useEffect(() => {
    const text = mission.trim();
    if (text.length < 12) {
      setCostEst(null);
      return;
    }
    const t = window.setTimeout(() => {
      void requestJson("/missions/estimate-cost", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          mission: text,
          agents: [agent],
          mode: "cio",
          refinement_rounds: refinementEnabled ? refinementRounds : 0,
        }),
      })
        .then(({ data }) => setCostEst(data))
        .catch(() => setCostEst(null));
    }, 500);
    return () => window.clearTimeout(t);
  }, [mission, agent, refinementEnabled, refinementRounds]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!mission.trim()) return;
    setBusy(true);
    setMsg("");
    try {
      const rounds = clampRefinementRounds(refinementRounds);
      const payload: {
        mission: string;
        agent: string;
        mission_config?: {
          recursive_refinement_enabled?: boolean;
          recursive_max_rounds?: number;
          cio_plan_hitl_enabled?: boolean;
        };
      } = { mission: mission.trim(), agent };
      const mcfg: {
        recursive_refinement_enabled?: boolean;
        recursive_max_rounds?: number;
        cio_plan_hitl_enabled?: boolean;
      } = {};
      if (refinementEnabled) {
        mcfg.recursive_refinement_enabled = true;
        mcfg.recursive_max_rounds = rounds;
      }
      if (skipPlanHitl) {
        mcfg.cio_plan_hitl_enabled = false;
      }
      if (Object.keys(mcfg).length) {
        payload.mission_config = mcfg;
      }
      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(payload),
        timeoutMs: 20000,
      });
      setLastMissionPrompt(mission.trim());
      setMsg(`Mission acceptee: #${data.job_id}`);
      setJobId(String(data.job_id || ""));
      setMission("");
      qc.invalidateQueries({ queryKey: QK.jobsCards });
      qc.invalidateQueries({ queryKey: QK.tokens });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const requestCancel = async () => {
    if (!jobId) return;
    setCancelBusy(true);
    setMsg("");
    try {
      await requestJson(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        headers: agentHeaders(),
        retries: 0,
      });
      setMsg("Arrêt demandé : la mission s'interrompt dès la prochaine étape (quelques secondes).");
      await qc.invalidateQueries({ queryKey: ["job-live", jobId] });
      await qc.invalidateQueries({ queryKey: QK.jobsCards });
    } catch (err) {
      setMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <PageShell size="wide" className="space-y-6">
      <PageHeader
        accent="emerald"
        badge="Lancement"
        title="Nouvelle mission"
        description="Décrivez la mission, lancez l'exécution et suivez plusieurs missions en parallèle depuis cette page."
      />
      <div className="mobile-tab-bar lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePane("liste")}
          className={`mobile-tab ${mobilePane === "liste" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
        >
          En cours
        </button>
        <button
          type="button"
          onClick={() => setMobilePane("suivi")}
          className={`mobile-tab ${mobilePane === "suivi" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
        >
          Lancer / suivi
        </button>
      </div>

      <div className="grid w-full min-w-0 max-w-full gap-6 lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)] lg:items-start">
        <aside
          className={`min-w-0 space-y-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-24 lg:max-h-[min(70dvh,calc(100dvh-8rem))] lg:overflow-y-auto ${
            mobilePane === "liste" ? "block" : "hidden lg:block"
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missions en cours</p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Statuts <span className="font-medium text-slate-700">en attente</span> ou{" "}
            <span className="font-medium text-slate-700">en exécution</span>. Cliquez pour afficher le même suivi que
            sous le formulaire.
          </p>
          {jobsList.isLoading ? <p className="text-xs text-slate-400">Chargement…</p> : null}
          {jobsList.isError ? <p className="text-xs text-red-600">Liste indisponible.</p> : null}
          <ul className="space-y-2">
            {runningJobs.map((j) => {
              const active = jobId === j.job_id;
              return (
                <li key={j.job_id}>
                  <button
                    type="button"
                    onClick={() => pickRunningJob(j)}
                    className={`min-h-[44px] w-full rounded-xl border p-3 text-left transition-colors ${
                      active ? "border-slate-900 bg-slate-900 text-white shadow-sm" : "border-slate-200 bg-slate-50 hover:border-slate-300"
                    }`}
                  >
                    <p className={`font-mono text-[10px] ${active ? "text-slate-300" : "text-slate-500"}`}>#{j.job_id}</p>
                    <p className={`mt-0.5 line-clamp-2 text-sm font-medium leading-snug ${active ? "text-white" : "text-slate-900"}`}>
                      {j.mission?.trim() || "(sans titre)"}
                    </p>
                    <p className={`mt-1 text-[11px] ${active ? "text-slate-300" : "text-slate-500"}`}>
                      {j.agent || "coordinateur"} · {j.status}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          {!jobsList.isLoading && runningJobs.length === 0 ? (
            <p className="text-xs text-slate-400">Aucune mission active pour le moment.</p>
          ) : null}
        </aside>
        <div className={`min-w-0 max-w-full space-y-6 ${mobilePane === "suivi" ? "block" : "hidden lg:block"}`}>
          <form
            onSubmit={onSubmit}
            className="mx-auto max-w-2xl space-y-5 rounded-2xl border-2 border-violet-200 bg-white p-6 shadow-md"
          >
            <div>
              <p className="text-lg font-extrabold text-slate-950">Lancer une mission</p>
              <p className="mt-1 text-sm font-semibold text-slate-600">
                Choisissez l&apos;agent pilote, décrivez la consigne, puis suivez l&apos;exécution ci-dessous.
              </p>
            </div>
            <div>
              <label htmlFor="nouvelle-agent" className="field-label">
                Agent
              </label>
              <select
                id="nouvelle-agent"
                value={agent}
                onChange={(e) => setAgent(e.target.value)}
                className="field-input"
              >
                {(agents.data || []).map((a: { key: string; label: string }, i: number) => (
                  <option key={`${a.key}-${i}`} value={a.key}>
                    {a.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="nouvelle-mission" className="field-label">
                Mission
              </label>
              <textarea
                id="nouvelle-mission"
                rows={6}
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                className="field-input leading-relaxed"
                placeholder="Décris la mission à exécuter…"
              />
            </div>
            {costEst ? (
              <div className="rounded-xl border-2 border-violet-300 bg-violet-50 px-4 py-3 text-sm font-bold text-violet-950">
                Estimation ~ <span className="text-lg">${Number(costEst.estimated_cost_usd || 0).toFixed(3)}</span>
                {costEst.tier ? ` · tier ${costEst.tier}` : ""}
                {(costEst.warnings || []).map((w) => (
                  <p key={w} className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-sm font-extrabold text-amber-950">
                    {w}
                  </p>
                ))}
              </div>
            ) : null}
            <fieldset className="rounded-xl border border-amber-100 bg-amber-50/40 px-3 py-3">
              <legend className="px-1 text-xs font-semibold text-amber-950">Boucle d&apos;exécution (optionnel)</legend>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-amber-900/80">Boucle d&apos;affinage CIO</p>
              <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-800">
                <input
                  type="checkbox"
                  checked={refinementEnabled}
                  onChange={(e) => setRefinementEnabled(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
                />
                <span className="leading-relaxed">
                  Activer jusqu&apos;à{" "}
                  {refinementEnabled ? (
                    <span className="inline-flex flex-wrap items-center gap-1 align-middle">
                      <input
                        id="nouvelle-refine-rounds"
                        type="number"
                        min={1}
                        max={MAX_REFINEMENT_ROUNDS}
                        value={refinementRounds}
                        onChange={(e) => setRefinementRounds(clampRefinementRounds(e.target.value))}
                        className="w-16 rounded-md border border-amber-200/80 bg-white px-2 py-0.5 text-center text-sm font-semibold tabular-nums text-amber-950"
                      />
                      <strong>tours</strong>
                    </span>
                  ) : (
                    <strong>
                      {refinementRounds} tour{refinementRounds > 1 ? "s" : ""}
                    </strong>
                  )}{" "}
                  de <strong>boucle d&apos;exécution</strong> après la première synthèse (critique CIO → replan + équipe si
                  besoin → nouvelle synthèse ; arrêt si « RAS »).
                </span>
              </label>
              {refinementEnabled ? (
                <div className="mt-3 space-y-2 border-t border-amber-100/80 pt-3">
                  <p className="text-xs text-amber-950/90">
                    Plafond : {MAX_REFINEMENT_ROUNDS} tours. Chaque tour rejoue une chaîne LLM complète (coût tokens élevé).
                  </p>
                  <p className="text-xs text-slate-600">
                    Toujours <strong>médiatisé par le CIO</strong> ; boucles CIO ↔ équipe, pas dialogue libre entre
                    sous-agents.
                  </p>
                </div>
              ) : null}
            </fieldset>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={skipPlanHitl}
                onChange={(e) => setSkipPlanHitl(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300"
              />
              <span className="leading-relaxed">
                <strong>Sans pause</strong> sur le plan CIO : lancer la délégation aux sous-agents immédiatement (équivalent
                désactiver la validation HITL du plan).
              </span>
            </label>
            <button type="submit" disabled={busy} className="btn-primary w-full sm:w-auto">
              {busy ? "Lancement…" : "Lancer la mission"}
            </button>
            {msg ? (
              <p className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700" role="status">
                {msg}
              </p>
            ) : null}
          </form>
          {jobId ? (
            <MissionJobLiveDetail
              jobId={jobId}
              missionPrompt={lastMissionPrompt}
              agentFallback={agent}
              agentLabelMap={agentLabelMap}
              live={{
                data: jobLive.data,
                isLoading: jobLive.isLoading,
                isError: jobLive.isError,
              }}
              onRequestCancel={requestCancel}
              cancelBusy={cancelBusy}
              onDeliverablesSaved={() => void qc.invalidateQueries({ queryKey: ["job-live", jobId] })}
            />
          ) : null}
        </div>
      </div>
    </PageShell>
  );
}
