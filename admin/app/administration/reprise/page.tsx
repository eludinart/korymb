"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import RepriseChecklistItemRow, {
  getUserAction,
} from "../../../components/reprise/RepriseChecklistItemRow";
import { PageHeader, PageLink, PageShell } from "../../../components/ui/PageChrome";
import { requestJson, agentHeaders } from "../../../lib/api";
import {
  REPRISE_COVERAGE_QUERY_KEY,
  STATUS_DOT,
  STATUS_LABELS,
  STATUS_STYLES,
  formatCoveragePct,
  repriseItemKey,
  useRepriseCoverage,
  useRepriseItemAction,
  useRepriseItemsLaunch,
  useRepriseItemsMissions,
  type CoverageResult,
  type RepriseChecklistSelection,
} from "../../../lib/repriseCoverage";

export default function RepriseAuditPage() {
  const qc = useQueryClient();
  const [auditMessage, setAuditMessage] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, true>>({});

  const coverageQuery = useRepriseCoverage();
  const itemActionMut = useRepriseItemAction();
  const itemsMissionsMut = useRepriseItemsMissions();
  const itemsLaunchMut = useRepriseItemsLaunch();

  const auditMut = useMutation({
    mutationFn: async (generateProposals: boolean) => {
      const res = await requestJson("/admin/reprise/audit", {
        method: "POST",
        headers: { ...agentHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ nb_proposals: 5, generate_proposals: generateProposals }),
      });
      return res.data as { coverage: CoverageResult; created: number; message: string };
    },
    onSuccess: (data) => {
      setAuditError(null);
      setAuditMessage(data.message || `${data.created} proposition(s) créée(s).`);
      qc.setQueryData(REPRISE_COVERAGE_QUERY_KEY, data.coverage);
      if (data.created > 0) {
        qc.invalidateQueries({ queryKey: ["scheduler-outputs"] });
        qc.invalidateQueries({ queryKey: ["admin-inbox"] });
        qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      }
    },
    onError: (err: Error) => {
      setAuditMessage(null);
      setAuditError(err.message || "Échec de l'audit reprise.");
    },
  });

  const data = coverageQuery.data;
  const busy =
    coverageQuery.isFetching ||
    auditMut.isPending ||
    itemActionMut.isPending ||
    itemsMissionsMut.isPending ||
    itemsLaunchMut.isPending;

  const selectedItems = useMemo((): RepriseChecklistSelection[] => {
    if (!data) return [];
    const out: RepriseChecklistSelection[] = [];
    for (const d of data.domains) {
      const items = [
        ...d.checklist_missing,
        ...d.checklist_covered,
        ...(d.checklist_deferred ?? []),
      ];
      for (const item of items) {
        const key = repriseItemKey(d.id, item);
        if (!selected[key]) continue;
        const prior = data.user_actions?.[key]?.action;
        if (prior === "mission_pending") continue;
        out.push({ domain_id: d.id, item_text: item });
      }
    }
    return out;
  }, [data, selected]);

  const toggleSelect = (domainId: string, itemText: string) => {
    const key = repriseItemKey(domainId, itemText);
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const runItemAction = async (
    domainId: string,
    itemText: string,
    action: "validated" | "noted" | "deferred",
    note: string,
  ) => {
    setActionMessage(null);
    setActionError(null);
    try {
      const res = await itemActionMut.mutateAsync({ domain_id: domainId, item_text: itemText, action, note });
      const mem = res.memory_contexts_updated?.length
        ? ` Mémoire : ${res.memory_contexts_updated.join(", ")}.`
        : "";
      setActionMessage(
        (action === "validated"
          ? "Point validé — intégré à la mémoire entreprise."
          : action === "noted"
            ? "Information enregistrée — le prochain scan en tiendra compte."
            : "Point reporté.") + mem,
      );
      setSelected((prev) => {
        const next = { ...prev };
        delete next[repriseItemKey(domainId, itemText)];
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Action impossible.");
    }
  };

  const runCreateMission = async (domainId: string, itemText: string, note: string) => {
    setActionMessage(null);
    setActionError(null);
    try {
      const res = await itemsMissionsMut.mutateAsync([{ domain_id: domainId, item_text: itemText, note }]);
      setActionMessage(res.message || "Mission proposée — validez-la dans Approbations.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Création de mission impossible.");
    }
  };

  const runLaunchAgents = async (domainId: string, itemText: string, note: string) => {
    setActionMessage(null);
    setActionError(null);
    try {
      const res = await itemsLaunchMut.mutateAsync({
        items: [{ domain_id: domainId, item_text: itemText, note }],
      });
      const jobId = res.jobs?.[0]?.job_id;
      const relaunch = res.jobs?.[0]?.relaunch;
      setActionMessage(
        jobId
          ? `${relaunch ? "Agents relancés" : "Agents lancés"} — mission #${jobId}. ${res.memory_contexts_updated?.length ? `Mémoire : ${res.memory_contexts_updated.join(", ")}.` : ""}`
          : res.message || (relaunch ? "Agents relancés sur ce point." : "Agents lancés sur ce point."),
      );
      setSelected((prev) => {
        const next = { ...prev };
        delete next[repriseItemKey(domainId, itemText)];
        return next;
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lancement des agents impossible.");
    }
  };

  const runBatchLaunch = async () => {
    if (!selectedItems.length) return;
    setActionMessage(null);
    setActionError(null);
    try {
      const res = await itemsLaunchMut.mutateAsync({ items: selectedItems });
      setActionMessage(res.message);
      setSelected({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Lancement des agents impossible.");
    }
  };

  const runBatchMissions = async () => {
    if (!selectedItems.length) return;
    setActionMessage(null);
    setActionError(null);
    try {
      const res = await itemsMissionsMut.mutateAsync(selectedItems);
      setActionMessage(res.message);
      setSelected({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Création des missions impossible.");
    }
  };

  const runBatchValidate = async () => {
    if (!selectedItems.length) return;
    setActionMessage(null);
    setActionError(null);
    try {
      for (const item of selectedItems) {
        await itemActionMut.mutateAsync({
          domain_id: item.domain_id,
          item_text: item.item_text,
          action: "validated",
        });
      }
      setActionMessage(`${selectedItems.length} point(s) validé(s) et intégré(s) à la mémoire.`);
      setSelected({});
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Validation impossible.");
    }
  };

  useEffect(() => {
    if (!data) return;
    const hash = typeof window !== "undefined" ? window.location.hash.replace(/^#/, "") : "";
    if (!hash.startsWith("domain-")) return;
    const el = document.getElementById(hash);
    if (!el) return;
    if (el instanceof HTMLDetailsElement) el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [data]);

  return (
    <PageShell size="wide">
      <PageHeader
        accent="amber"
        badge="Pilotage projet"
        title="Audit reprise d'entreprise"
        description="Checklist des domaines à ne pas rater : lancez les agents sur un sujet, alimentez le contexte global et les volets métiers, validez ou affinez — l'organisation du projet s'enrichit à chaque réponse."
        actions={
          <>
            <PageLink href="/briefing">Briefing</PageLink>
            <PageLink href="/inbox" variant="secondary">
              Inbox
            </PageLink>
            <PageLink href="/administration/memory" variant="secondary">
              Mémoire
            </PageLink>
          </>
        }
      />

      <div className="space-y-6">

      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setAuditMessage(null);
            setAuditError(null);
            void coverageQuery.refetch();
          }}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {coverageQuery.isFetching ? "Scan en cours…" : "Scanner à nouveau"}
        </button>
        <button
          type="button"
          disabled={busy || !data?.gaps?.length}
          onClick={() => auditMut.mutate(true)}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-800 disabled:opacity-50"
        >
          {auditMut.isPending ? "Génération…" : "Générer missions pour les lacunes"}
        </button>
        <Link
          href="/administration/memory"
          className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-semibold text-violet-900 hover:bg-violet-100"
        >
          Enrichir la mémoire
        </Link>
        <Link
          href="/administration/approbations"
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          Voir les approbations
        </Link>
      </div>

      {auditMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {auditMessage}
        </p>
      ) : null}
      {auditError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{auditError}</p>
      ) : null}
      {actionMessage ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {actionMessage}
        </p>
      ) : null}
      {actionError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{actionError}</p>
      ) : null}

      {selectedItems.length > 0 ? (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-violet-300 bg-violet-50 px-4 py-3 shadow-md">
          <span className="text-sm font-bold text-violet-900">
            {selectedItems.length} point{selectedItems.length > 1 ? "s sélectionnés" : " sélectionné"}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBatchLaunch()}
            className="rounded-xl bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800 disabled:opacity-50"
          >
            Lancer les agents sur la sélection
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBatchMissions()}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
          >
            Proposer missions (approbation)
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void runBatchValidate()}
            className="rounded-xl border border-emerald-400 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
          >
            Marquer comme traités
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelected({})}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Annuler la sélection
          </button>
        </div>
      ) : null}

      {coverageQuery.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          Impossible de charger le scan — vérifiez que le backend répond.
        </p>
      ) : null}

      {coverageQuery.isLoading ? (
        <p className="text-sm text-slate-500">Chargement du scan reprise…</p>
      ) : data ? (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Couverture globale</p>
              <p className="mt-1 text-3xl font-extrabold text-slate-900">{formatCoveragePct(data.coverage_score)}</p>
            </div>
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-emerald-700">Couvert</p>
              <p className="mt-1 text-2xl font-bold text-emerald-900">{data.summary.covered}</p>
            </div>
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-amber-700">Partiel</p>
              <p className="mt-1 text-2xl font-bold text-amber-900">{data.summary.partial}</p>
            </div>
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="text-xs font-bold uppercase tracking-wide text-red-700">Manquant</p>
              <p className="mt-1 text-2xl font-bold text-red-900">{data.summary.missing}</p>
            </div>
          </section>

          {!data.has_reprise_context ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Peu de contexte « reprise » détecté. Ajoutez dans{" "}
              <Link href="/administration/memory" className="font-semibold underline">
                Mémoire entreprise → Contexte global
              </Link>{" "}
              les objectifs de reprise, le calendrier et les points déjà traités.
            </p>
          ) : null}

          <section>
            <h2 className="section-title mb-4">Checklist par domaine</h2>
            <div className="space-y-3">
              {data.domains.map((d) => (
                <details
                  key={d.id}
                  id={`domain-${d.id}`}
                  className={`scroll-mt-24 rounded-2xl border p-4 shadow-sm ${STATUS_STYLES[d.status]}`}
                  open={d.status !== "covered"}
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[d.status]}`} />
                      <span className="font-semibold">{d.label}</span>
                      <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium">
                        {STATUS_LABELS[d.status]}
                      </span>
                      {d.keyword_hits.length > 0 ? (
                        <span className="text-xs opacity-80">
                          Indices : {d.keyword_hits.slice(0, 3).join(", ")}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs opacity-80">{d.description}</p>
                  </summary>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    {d.checklist_missing.length > 0 ? (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide">À traiter</p>
                        <ul className="mt-2 space-y-2">
                          {d.checklist_missing.map((item) => (
                            <RepriseChecklistItemRow
                              key={item}
                              domainId={d.id}
                              itemText={item}
                              variant="missing"
                              suggestedAgents={d.suggested_agents}
                              userAction={getUserAction(data.user_actions, d.id, item)}
                              selected={Boolean(selected[repriseItemKey(d.id, item)])}
                              busy={busy}
                              onToggleSelect={() => toggleSelect(d.id, item)}
                              onAction={(action, note) => void runItemAction(d.id, item, action, note)}
                              onLaunchAgents={(note) => void runLaunchAgents(d.id, item, note)}
                              onCreateMission={(note) => void runCreateMission(d.id, item, note)}
                            />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {d.checklist_covered.length > 0 ? (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide">Déjà signalé</p>
                        <ul className="mt-2 space-y-2 opacity-95">
                          {d.checklist_covered.map((item) => (
                            <RepriseChecklistItemRow
                              key={item}
                              domainId={d.id}
                              itemText={item}
                              variant="covered"
                              suggestedAgents={d.suggested_agents}
                              userAction={getUserAction(data.user_actions, d.id, item)}
                              selected={Boolean(selected[repriseItemKey(d.id, item)])}
                              busy={busy}
                              onToggleSelect={() => toggleSelect(d.id, item)}
                              onAction={(action, note) => void runItemAction(d.id, item, action, note)}
                              onLaunchAgents={(note) => void runLaunchAgents(d.id, item, note)}
                              onCreateMission={(note) => void runCreateMission(d.id, item, note)}
                            />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {(d.checklist_deferred?.length ?? 0) > 0 ? (
                      <div className="md:col-span-2">
                        <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Reportés</p>
                        <ul className="mt-2 space-y-2">
                          {(d.checklist_deferred ?? []).map((item) => (
                            <RepriseChecklistItemRow
                              key={`deferred-${item}`}
                              domainId={d.id}
                              itemText={item}
                              variant="covered"
                              suggestedAgents={d.suggested_agents}
                              userAction={getUserAction(data.user_actions, d.id, item)}
                              selected={Boolean(selected[repriseItemKey(d.id, item)])}
                              busy={busy}
                              onToggleSelect={() => toggleSelect(d.id, item)}
                              onAction={(action, note) => void runItemAction(d.id, item, action, note)}
                              onLaunchAgents={(note) => void runLaunchAgents(d.id, item, note)}
                              onCreateMission={(note) => void runCreateMission(d.id, item, note)}
                            />
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          </section>

          {data.gaps.length > 0 ? (
            <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-5">
              <h2 className="text-sm font-bold text-violet-900">
                {data.gaps.length} lacune(s) prioritaire(s)
              </h2>
              <p className="mt-1 text-sm text-violet-800">
                Cliquez sur « Générer missions pour les lacunes » pour créer des propositions concrètes
                (titres actionnables, livrables, coût estimé) dans la file d&apos;approbation.
              </p>
            </section>
          ) : (
            <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-sm text-emerald-900">
              Tous les domaines semblent couverts dans votre contexte actuel. Relancez un scan après
              de nouvelles missions ou une mise à jour de la mémoire.
            </section>
          )}
        </>
      ) : null}
      </div>
    </PageShell>
  );
}
