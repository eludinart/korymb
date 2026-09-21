"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { AlertBox, LoadingLine } from "../../components/ui/PageChrome";
import MapBoard from "../../components/carte/MapBoard";
import MapInspector from "../../components/carte/MapInspector";
import { agentHeaders, requestJson } from "../../lib/api";
import { businessApi } from "../../lib/business";
import {
  confirmDeleteMission,
  deleteMissionJobBundle,
  invalidateAfterMissionDelete,
} from "../../lib/deleteMissionBundle";
import {
  buildMapBoard,
  canDeleteMapNode,
  loadHiddenMapIds,
  mapNodeJobId,
  mapNodeProjectId,
  matchesMapQuery,
  saveHiddenMapIds,
  waitingNodes,
  type MapNode,
  type OperationalMapPayload,
} from "../../lib/operationalMap";
import { QK } from "../../lib/queryClient";

type FilterId = "work" | "live" | "waiting" | "crm" | "knowledge";

export default function CartePage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterId>("work");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [situationOpen, setSituationOpen] = useState(false);
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [launchBusy, setLaunchBusy] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionOk, setActionOk] = useState("");

  useEffect(() => {
    setHiddenIds(loadHiddenMapIds());
  }, []);

  useEffect(() => {
    if (!actionOk) return;
    const t = window.setTimeout(() => setActionOk(""), 5000);
    return () => window.clearTimeout(t);
  }, [actionOk]);

  const mapQ = useQuery({
    queryKey: QK.operationalMap,
    queryFn: async () => {
      const { data } = await requestJson("/overview/map", { headers: agentHeaders(), retries: 1, timeoutMs: 30_000 });
      return data as OperationalMapPayload;
    },
    staleTime: 20_000,
  });

  const nodes = mapQ.data?.nodes || [];
  const edges = mapQ.data?.edges || [];
  const stats = mapQ.data?.stats || {};
  const hidden = useMemo(() => new Set(hiddenIds), [hiddenIds]);

  const counts = useMemo(() => {
    const missions = nodes.filter((n) => n.kind === "mission" && !hidden.has(n.id));
    const projects = nodes.filter((n) => n.kind === "project" && !hidden.has(n.id));
    const knowledge = nodes.filter((n) => n.kind === "knowledge" && !hidden.has(n.id));
    return {
      work: missions.length + projects.length,
      live: missions.filter((n) => n.urgency === "active" || n.urgency === "waiting").length,
      waiting: missions.filter((n) => n.urgency === "waiting" || n.urgency === "blocked").length,
      crm: projects.length,
      knowledge: knowledge.length,
    };
  }, [hidden, nodes]);

  const filters: { id: FilterId; label: string; count: number }[] = [
    { id: "work", label: "Travail", count: counts.work },
    { id: "live", label: "En cours", count: counts.live },
    { id: "waiting", label: "À valider", count: counts.waiting },
    { id: "crm", label: "Clients", count: counts.crm },
    { id: "knowledge", label: "Univers", count: counts.knowledge },
  ];

  const visibleNodes = useMemo(() => {
    const notHidden = (n: MapNode) => !hidden.has(n.id);
    if (filter === "knowledge") return nodes.filter((n) => n.kind === "knowledge" && notHidden(n));
    if (filter === "crm") return nodes.filter((n) => (n.kind === "project" || n.kind === "mission") && notHidden(n));

    const teams = nodes.filter((n) => n.kind === "team" && notHidden(n));
    const cards = nodes.filter((n) => {
      if (!notHidden(n)) return false;
      if (n.kind === "agent" || n.kind === "contact" || n.kind === "team" || n.kind === "knowledge") return false;
      if (filter === "work") return n.kind === "mission" || n.kind === "project";
      if (filter === "live") return n.urgency === "active" || n.urgency === "waiting";
      if (filter === "waiting") return n.urgency === "waiting" || n.urgency === "blocked";
      return true;
    });
    return [...teams, ...cards];
  }, [nodes, filter, hidden]);

  const visibleIds = useMemo(() => new Set(visibleNodes.map((n) => n.id)), [visibleNodes]);
  const visibleEdges = useMemo(
    () => edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    [edges, visibleIds],
  );

  const board = useMemo(() => {
    const raw = buildMapBoard(visibleNodes, visibleEdges, {
      includeKnowledge: filter === "knowledge",
      groupBy: filter === "crm" ? "project" : "team",
    });
    if (filter === "live" || filter === "waiting") {
      return { ...raw, clusters: raw.clusters.filter((c) => c.cards.length > 0) };
    }
    return raw;
  }, [visibleNodes, visibleEdges, filter]);

  const nodesById = useMemo(() => {
    const m = new Map<string, MapNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const selected = selectedId ? nodesById.get(selectedId) || null : null;
  const searchHits = useMemo(() => {
    const q = query.trim();
    if (q.length < 2) return 0;
    return visibleNodes.filter((n) => n.kind !== "team" && matchesMapQuery(n, q)).length;
  }, [query, visibleNodes]);

  const nextWaiting = waitingNodes(visibleNodes).find((n) => n.kind === "mission" || n.kind === "project") || null;
  const sheetOpen = Boolean(selectedId) || situationOpen;

  const closeSheet = () => {
    setSelectedId(null);
    setSituationOpen(false);
  };

  const selectNode = (id: string | null) => {
    if (!id) {
      closeSheet();
      return;
    }
    setSelectedId(id);
    setSituationOpen(false);
  };

  const openNode = (node: MapNode) => {
    const href = node.cta?.href || node.href;
    if (href) router.push(href);
  };

  const launchMission = async (groupId: string, mission: string) => {
    setActionError("");
    setActionOk("");
    setLaunchBusy(true);
    try {
      const { data } = await requestJson("/run", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          mission,
          agent: "coordinateur",
          mission_config: { agent_group_id: groupId, orchestrator_key: "coordinateur" },
        }),
        timeoutMs: 20_000,
      });
      const jobId = String((data as { job_id?: string })?.job_id || "");
      void qc.invalidateQueries({ queryKey: QK.operationalMap });
      void qc.invalidateQueries({ queryKey: QK.jobsCards });
      void qc.invalidateQueries({ queryKey: QK.tokens });
      setActionOk("Mission lancée dans cette équipe.");
      if (jobId) setSelectedId(`mission:${jobId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Lancement impossible.";
      setActionError(msg);
      throw err;
    } finally {
      setLaunchBusy(false);
    }
  };

  const linkMissionToProject = async (jobId: string, projectId: string) => {
    if (!jobId || !projectId || linkBusy) return;
    setActionError("");
    setActionOk("");
    setLinkBusy(true);
    try {
      const prj = await businessApi.getProject(projectId);
      const current = (prj.linked_job_ids || []).map(String);
      if (current.includes(jobId)) {
        setActionOk("Cette mission est déjà rattachée à ce dossier.");
        return;
      }
      await businessApi.updateProject(projectId, { linked_job_ids: [...current, jobId] });
      void qc.invalidateQueries({ queryKey: QK.operationalMap });
      setActionOk(`Mission rattachée à « ${prj.title} ».`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Rattachement impossible.");
    } finally {
      setLinkBusy(false);
    }
  };

  const hideNode = (node: MapNode) => {
    const next = [...new Set([...hiddenIds, node.id])];
    setHiddenIds(next);
    saveHiddenMapIds(next);
    if (selectedId === node.id) closeSheet();
  };

  const restoreHidden = () => {
    setHiddenIds([]);
    saveHiddenMapIds([]);
  };

  const deleteNode = async (node: MapNode) => {
    if (!canDeleteMapNode(node) || deleteBusy) return;
    setActionError("");
    if (node.kind === "mission") {
      const jobId = mapNodeJobId(node);
      if (!jobId || !confirmDeleteMission(jobId, node.label)) return;
      setDeleteBusy(true);
      try {
        await deleteMissionJobBundle([jobId]);
        invalidateAfterMissionDelete(qc);
        closeSheet();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Suppression impossible.");
      } finally {
        setDeleteBusy(false);
      }
      return;
    }
    if (node.kind === "project") {
      const projectId = mapNodeProjectId(node);
      if (!projectId) return;
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Supprimer définitivement le dossier « ${node.label} » ?\n\nCette action enlève le projet CRM. Les missions liées restent, sans ce dossier.`,
        )
      ) {
        return;
      }
      setDeleteBusy(true);
      try {
        await businessApi.deleteProject(projectId);
        void qc.invalidateQueries({ queryKey: QK.operationalMap });
        closeSheet();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : "Suppression du dossier impossible.");
      } finally {
        setDeleteBusy(false);
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "Escape") {
        setSelectedId(null);
        setSituationOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onHitlResolved = () => {
    void qc.invalidateQueries({ queryKey: QK.operationalMap });
    setActionOk("Décision enregistrée.");
  };

  const inspectorProps = {
    node: selected,
    nodes: visibleNodes,
    edges: visibleEdges,
    nodesById,
    stats,
    deleteBusy,
    linkBusy,
    onSelect: selectNode,
    onOpen: openNode,
    onHide: hideNode,
    onDelete: deleteNode,
    onLinkProject: linkMissionToProject,
    onHitlResolved,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#e8edf7]">
      <div className="shrink-0 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur sm:px-4">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold uppercase tracking-wide text-sky-800">Orientation</p>
            <h1 className="truncate text-base font-semibold text-slate-900">Carte du QG</h1>
          </div>
          {hiddenIds.length ? (
            <button
              type="button"
              className="touch-target rounded-full bg-slate-100 px-3 text-xs font-bold text-slate-700"
              onClick={restoreHidden}
            >
              {hiddenIds.length} masqué{hiddenIds.length > 1 ? "s" : ""} · tout voir
            </button>
          ) : null}
          <button
            type="button"
            className="touch-target rounded-full bg-amber-50 px-3 text-xs font-bold text-amber-950 ring-1 ring-amber-200 lg:hidden"
            onClick={() => {
              setSelectedId(null);
              setSituationOpen(true);
            }}
          >
            {stats.waiting ?? counts.waiting} à valider
          </button>
          <p className="hidden text-xs font-medium text-slate-500 lg:block">
            {stats.waiting ?? counts.waiting} à valider · {stats.active ?? counts.live} en cours
          </p>
        </div>
        {nextWaiting ? (
          <button
            type="button"
            onClick={() => selectNode(nextWaiting.id)}
            className="mt-2 flex w-full items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-left ring-1 ring-amber-200 lg:hidden"
          >
            <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
            <span className="min-w-0">
              <span className="block text-[10px] font-bold uppercase tracking-wide text-amber-800">À traiter</span>
              <span className="block truncate text-sm font-semibold text-slate-900">{nextWaiting.label}</span>
              <span className="mt-0.5 block line-clamp-2 text-xs text-amber-900/80">
                {nextWaiting.detail || nextWaiting.next || nextWaiting.where}
              </span>
            </span>
          </button>
        ) : null}
        <div className="mt-2 h-scroll-nav">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${
                filter === f.id ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600 hover:text-slate-900"
              }`}
            >
              {f.label}
              <span className={filter === f.id ? "text-white/70" : "text-slate-400"}>{f.count}</span>
            </button>
          ))}
        </div>
        <label className="relative mt-2 block">
          <span className="sr-only">Rechercher sur la carte</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher une mission, une équipe…"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-base text-slate-800 outline-none ring-sky-200 placeholder:text-slate-400 focus:ring-2 lg:py-1.5 lg:text-sm"
          />
          {searchHits > 0 ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-semibold text-slate-400">
              {searchHits}
            </span>
          ) : null}
        </label>
      </div>

      {mapQ.isLoading ? (
        <div className="px-4 py-3">
          <LoadingLine label="Construction du tableau…" />
        </div>
      ) : null}
      {mapQ.isError ? (
        <div className="px-4 py-3">
          <AlertBox tone="error" title="Carte indisponible">
            Impossible de charger les équipes et missions. Vérifiez que le backend tourne.
          </AlertBox>
        </div>
      ) : null}
      {actionOk ? (
        <div className="px-4 py-3">
          <AlertBox tone="success" title="C’est fait">
            {actionOk}
          </AlertBox>
        </div>
      ) : null}
      {actionError ? (
        <div className="px-4 py-3">
          <AlertBox tone="error" title="Action impossible">
            {actionError}
          </AlertBox>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <MapBoard
          board={board}
          edges={visibleEdges}
          selectedId={selectedId}
          query={query}
          launchBusy={launchBusy}
          onSelect={selectNode}
          onLaunch={launchMission}
          onLinkMission={linkMissionToProject}
        />
        <div className="hidden min-h-0 lg:block">
          <MapInspector {...inspectorProps} />
        </div>
      </div>

      {sheetOpen ? (
        <div className="fixed inset-0 z-[70] lg:hidden" role="dialog" aria-modal="true" aria-label="Détail">
          <button type="button" className="absolute inset-0 bg-slate-900/45" aria-label="Fermer" onClick={closeSheet} />
          <div className="absolute inset-x-0 bottom-0 overflow-hidden rounded-t-3xl shadow-2xl">
            <MapInspector {...inspectorProps} layout="sheet" />
          </div>
        </div>
      ) : null}
    </div>
  );
}
