"use client";

import { useEffect, useMemo, useState } from "react";
import type { MapBoard, MapCluster, MapEdge, MapNode } from "../../lib/operationalMap";
import {
  MAP_KIND_LABELS,
  MAP_URGENCY_LABELS,
  clusterTone,
  formatMapTime,
  mapNodeGroupId,
  mapNodeJobId,
  mapNodeProjectId,
  matchesMapQuery,
  neighborsOf,
  urgencyAccentClass,
  urgencyPillClass,
} from "../../lib/operationalMap";
import MapColumnLaunch from "./MapColumnLaunch";

const DRAG_MISSION = "application/x-korymb-mission";

type Props = {
  board: MapBoard;
  edges: MapEdge[];
  selectedId: string | null;
  query: string;
  launchBusy?: boolean;
  onSelect: (id: string | null) => void;
  onLaunch?: (groupId: string, mission: string) => Promise<void> | void;
  onLinkMission?: (jobId: string, projectId: string) => void;
};

function initials(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "•";
}

function dropProjectId(cluster: MapCluster): string {
  if (cluster.kind === "crm" && cluster.teamNode?.kind === "project") {
    return mapNodeProjectId(cluster.teamNode);
  }
  return "";
}

function WorkCard({
  node,
  selected,
  related,
  dimmed,
  dropActive,
  onSelect,
  onDragStart,
  onDragHover,
  onDropMission,
  canDrag,
}: {
  node: MapNode;
  selected: boolean;
  related: boolean;
  dimmed: boolean;
  dropActive?: boolean;
  onSelect: () => void;
  onDragStart?: (e: React.DragEvent) => void;
  onDragHover?: () => void;
  onDropMission?: (jobId: string) => void;
  canDrag?: boolean;
}) {
  const who = (node.who || []).filter(Boolean);
  const when = formatMapTime(node.updated_at);
  const draggable = Boolean(canDrag && node.kind === "mission");
  return (
    <div
      role="button"
      tabIndex={0}
      data-map-card={node.id}
      draggable={draggable}
      onDragStart={onDragStart}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      onDragOver={
        onDropMission
          ? (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "link";
              onDragHover?.();
            }
          : undefined
      }
      onDrop={
        onDropMission
          ? (e) => {
              e.preventDefault();
              e.stopPropagation();
              const jobId = e.dataTransfer.getData(DRAG_MISSION) || e.dataTransfer.getData("text/plain");
              if (jobId) onDropMission(jobId);
            }
          : undefined
      }
      onClick={onSelect}
      className={`relative w-full overflow-hidden rounded-xl border bg-white p-3 pl-3.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition ${
        selected
          ? "border-violet-400 ring-2 ring-violet-300"
          : dropActive
            ? "border-emerald-400 ring-2 ring-emerald-300"
            : related
              ? "border-violet-200 ring-1 ring-violet-200"
              : "border-slate-200/90 hover:border-slate-300 hover:shadow-md"
      } ${dimmed ? "opacity-35" : "opacity-100"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <span className={`absolute inset-y-0 left-0 w-[3px] ${urgencyAccentClass(node.urgency)}`} aria-hidden />
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{MAP_KIND_LABELS[node.kind]}</span>
        {node.urgency && node.urgency !== "idle" ? (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${urgencyPillClass(node.urgency)}`}>
            {MAP_URGENCY_LABELS[node.urgency]}
          </span>
        ) : null}
      </span>
      <span className="mt-1 block text-sm font-semibold leading-snug text-slate-900 [overflow-wrap:anywhere]">
        {node.label}
      </span>
      <span className="mt-1 block line-clamp-2 text-[12px] leading-snug text-slate-600 lg:line-clamp-3">
        {node.next || node.where || node.detail || node.subtitle || " "}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-1">
        {who.slice(0, 3).map((name) => (
          <span key={name} className="max-w-[7rem] truncate rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-900">
            {name}
          </span>
        ))}
        {who.length > 3 ? <span className="text-[10px] font-semibold text-slate-400">+{who.length - 3}</span> : null}
        {when ? <span className="ml-auto text-[10px] font-medium text-slate-400">{when}</span> : null}
      </span>
    </div>
  );
}

function Column({
  cluster,
  selectedId,
  neighbors,
  query,
  dragOverId,
  launchBusy,
  onSelect,
  onLaunch,
  onLinkMission,
  onDragOverTarget,
  canDrag,
  layout = "rail",
}: {
  cluster: MapCluster;
  selectedId: string | null;
  neighbors: Set<string>;
  query: string;
  dragOverId: string | null;
  launchBusy?: boolean;
  onSelect: (id: string | null) => void;
  onLaunch?: (groupId: string, mission: string) => Promise<void> | void;
  onLinkMission?: (jobId: string, projectId: string) => void;
  onDragOverTarget: (id: string | null) => void;
  canDrag?: boolean;
  layout?: "rail" | "page";
}) {
  const tone = clusterTone(cluster.kind);
  const selectedHere = selectedId === cluster.teamNode?.id;
  const q = query.trim();
  const dimColumn =
    Boolean(q) &&
    !matchesMapQuery({ id: cluster.id, label: cluster.title }, q) &&
    !cluster.cards.some((c) => matchesMapQuery(c.node, q));
  const groupId = cluster.teamNode ? mapNodeGroupId(cluster.teamNode) : "";
  const columnProjectId = dropProjectId(cluster);
  const canDropOnColumn = Boolean(onLinkMission && columnProjectId);

  const startDrag = (node: MapNode) => (e: React.DragEvent) => {
    const jobId = mapNodeJobId(node);
    if (!jobId) return;
    e.dataTransfer.setData(DRAG_MISSION, jobId);
    e.dataTransfer.setData("text/plain", jobId);
    e.dataTransfer.effectAllowed = "link";
  };

  return (
    <section
      id={`map-col-${cluster.id}`}
      data-map-cluster={cluster.id}
      className={`flex flex-col rounded-2xl border ${
        layout === "page" ? "w-full" : "h-full min-h-0 w-[min(88vw,20.5rem)] shrink-0 snap-start"
      } ${tone.wrap} ${selectedHere ? "ring-2 ring-sky-400" : ""} ${
        dragOverId === cluster.id ? "ring-2 ring-emerald-400" : ""
      } ${dimColumn ? "opacity-40" : ""}`}
      onDragOver={
        canDropOnColumn
          ? (e) => {
              e.preventDefault();
              onDragOverTarget(cluster.id);
            }
          : undefined
      }
      onDragLeave={() => {
        if (dragOverId === cluster.id) onDragOverTarget(null);
      }}
      onDrop={
        canDropOnColumn
          ? (e) => {
              e.preventDefault();
              onDragOverTarget(null);
              const jobId = e.dataTransfer.getData(DRAG_MISSION) || e.dataTransfer.getData("text/plain");
              if (jobId && columnProjectId) onLinkMission?.(jobId, columnProjectId);
            }
          : undefined
      }
    >
      <header className="shrink-0 px-3 pb-2 pt-3">
        <button
          type="button"
          className="flex min-h-[44px] w-full items-start justify-between gap-2 text-left"
          onClick={() => onSelect(cluster.teamNode?.id || cluster.id)}
        >
          <span className="min-w-0">
            <span className={`block truncate text-sm font-bold ${tone.head}`}>{cluster.title}</span>
            <span className="block text-[11px] font-medium text-slate-500">{cluster.hint}</span>
          </span>
          {cluster.agentLabels.length ? (
            <span className="flex -space-x-1.5">
              {cluster.agentLabels.slice(0, 4).map((name) => (
                <span
                  key={name}
                  title={name}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-white bg-violet-100 text-[9px] font-bold text-violet-900"
                >
                  {initials(name)}
                </span>
              ))}
            </span>
          ) : null}
        </button>
      </header>
      <div
        className={
          layout === "page"
            ? "space-y-2 px-2.5 pb-2"
            : "min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-y-contain touch-pan-y px-2.5 pb-3"
        }
      >
        {cluster.cards.length === 0 ? (
          <p className="px-1 py-4 text-center text-xs leading-relaxed text-slate-500">Rien à afficher ici pour ce filtre.</p>
        ) : (
          cluster.cards.map((card) => {
            const projectId = card.node.kind === "project" ? mapNodeProjectId(card.node) : "";
            return (
              <WorkCard
                key={card.node.id}
                node={card.node}
                selected={selectedId === card.node.id}
                related={Boolean(selectedId && neighbors.has(card.node.id) && selectedId !== card.node.id)}
                dimmed={Boolean(q) && !matchesMapQuery(card.node, q)}
                dropActive={Boolean(projectId && dragOverId === card.node.id)}
                canDrag={canDrag}
                onSelect={() => onSelect(card.node.id)}
                onDragStart={card.node.kind === "mission" ? startDrag(card.node) : undefined}
                onDragHover={projectId ? () => onDragOverTarget(card.node.id) : undefined}
                onDropMission={
                  projectId && onLinkMission
                    ? (jobId) => onLinkMission(jobId, projectId)
                    : undefined
                }
              />
            );
          })
        )}
        {onLaunch && groupId ? (
          <div className={layout === "page" ? "pb-24 pt-1" : ""}>
            <MapColumnLaunch
              teamLabel={cluster.title}
              busy={launchBusy}
              onLaunch={(mission) => onLaunch(groupId, mission)}
            />
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default function MapBoard({
  board,
  edges,
  selectedId,
  query,
  launchBusy,
  onSelect,
  onLaunch,
  onLinkMission,
}: Props) {
  const clusters = board.clusters;
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [canDrag, setCanDrag] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const neighbors = useMemo(() => (selectedId ? neighborsOf(selectedId, edges) : new Set<string>()), [edges, selectedId]);

  useEffect(() => {
    const dragMq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const deskMq = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setCanDrag(dragMq.matches);
      setIsDesktop(deskMq.matches);
    };
    sync();
    dragMq.addEventListener("change", sync);
    deskMq.addEventListener("change", sync);
    return () => {
      dragMq.removeEventListener("change", sync);
      deskMq.removeEventListener("change", sync);
    };
  }, []);

  const activeColumnId = useMemo(() => {
    if (focusId && clusters.some((c) => c.id === focusId)) return focusId;
    return clusters[0]?.id || null;
  }, [clusters, focusId]);

  const focusIndex = Math.max(0, clusters.findIndex((c) => c.id === activeColumnId));
  const focusCluster = clusters[focusIndex] || clusters[0] || null;

  useEffect(() => {
    if (!selectedId) return;
    const hit = clusters.find(
      (c) => c.id === selectedId || c.teamNode?.id === selectedId || c.cards.some((card) => card.node.id === selectedId),
    );
    if (hit) setFocusId(hit.id);
  }, [clusters, selectedId]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const hit = clusters.flatMap((c) => c.cards).find((card) => matchesMapQuery(card.node, q));
    if (!hit) return;
    const col = clusters.find((c) => c.cards.some((card) => card.node.id === hit.node.id));
    if (col) setFocusId(col.id);
    document
      .querySelector<HTMLElement>(`[data-map-card="${CSS.escape(hit.node.id)}"]`)
      ?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [clusters, query]);

  const jumpTo = (clusterId: string) => {
    setFocusId(clusterId);
    if (isDesktop) {
      document.getElementById(`map-col-${clusterId}`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
      return;
    }
    window.requestAnimationFrame(() => {
      document.getElementById(`map-col-${clusterId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const goRelative = (delta: number) => {
    const next = clusters[focusIndex + delta];
    if (next) jumpTo(next.id);
  };

  const columnProps = {
    selectedId,
    neighbors,
    query,
    dragOverId,
    launchBusy,
    onSelect,
    onLaunch,
    onLinkMission,
    onDragOverTarget: setDragOverId,
    canDrag,
  };

  if (!clusters.length) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <p className="max-w-sm text-center text-sm text-slate-500">
          Rien à afficher dans ce filtre. Revenez sur Travail pour voir les équipes et les missions.
        </p>
      </div>
    );
  }

  if (!isDesktop) {
    return (
      <div className="pb-safe">
        <div
          className="sticky z-20 flex items-center gap-1 border-b border-slate-200/80 bg-[#e8edf7] px-2 py-2"
          style={{ top: "var(--app-header-offset, 0px)" }}
        >
          <button
            type="button"
            className="touch-target shrink-0 rounded-full text-lg font-bold text-slate-600 disabled:opacity-30"
            disabled={focusIndex <= 0}
            aria-label="Équipe précédente"
            onClick={() => goRelative(-1)}
          >
            ‹
          </button>
          <nav className="h-scroll-nav min-w-0 flex-1" aria-label="Aller à une équipe">
            {clusters.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => jumpTo(c.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${
                  activeColumnId === c.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200"
                }`}
              >
                <span className="max-w-[9rem] truncate">{c.title}</span>
                <span className={activeColumnId === c.id ? "text-white/70" : "text-slate-400"}>{c.cards.length}</span>
              </button>
            ))}
          </nav>
          <button
            type="button"
            className="touch-target shrink-0 rounded-full text-lg font-bold text-slate-600 disabled:opacity-30"
            disabled={focusIndex >= clusters.length - 1}
            aria-label="Équipe suivante"
            onClick={() => goRelative(1)}
          >
            ›
          </button>
        </div>
        {focusCluster ? (
          <div className="px-3 py-3">
            <Column key={focusCluster.id} cluster={focusCluster} layout="page" {...columnProps} />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {clusters.length > 1 ? (
        <nav className="h-scroll-nav shrink-0 px-3 pt-2" aria-label="Aller à une équipe">
          {clusters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => jumpTo(c.id)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold ${
                activeColumnId === c.id ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
              }`}
            >
              <span className="max-w-[10rem] truncate">{c.title}</span>
              <span className={activeColumnId === c.id ? "text-white/70" : "text-slate-400"}>{c.cards.length}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {onLinkMission ? (
        <p className="px-3 pt-1 text-[11px] text-slate-400">
          Glissez une mission sur un dossier client pour la rattacher.
        </p>
      ) : null}
      <div
        className="flex min-h-0 flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain px-3 py-3 snap-x snap-proximity scroll-smooth"
        onDragEnd={() => setDragOverId(null)}
      >
        {clusters.map((cluster) => (
          <Column key={cluster.id} cluster={cluster} layout="rail" {...columnProps} />
        ))}
      </div>
    </div>
  );
}
