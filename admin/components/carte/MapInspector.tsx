"use client";

import Link from "next/link";
import MapHitlPanel from "./MapHitlPanel";
import type { MapEdge, MapNode } from "../../lib/operationalMap";
import {
  MAP_KIND_LABELS,
  MAP_URGENCY_LABELS,
  activeNodes,
  canDeleteMapNode,
  formatMapTime,
  isMapPlanHitl,
  mapNodeJobId,
  urgencyPillClass,
  waitingNodes,
} from "../../lib/operationalMap";
import { BTN_DELETE } from "../../lib/deleteMissionBundle";

type Props = {
  node: MapNode | null;
  nodes: MapNode[];
  edges: MapEdge[];
  nodesById: Map<string, MapNode>;
  stats: {
    teams?: number;
    missions?: number;
    active?: number;
    waiting?: number;
    projects?: number;
  };
  layout?: "dock" | "sheet";
  deleteBusy?: boolean;
  linkBusy?: boolean;
  onSelect: (id: string | null) => void;
  onOpen?: (node: MapNode) => void;
  onHide?: (node: MapNode) => void;
  onDelete?: (node: MapNode) => void;
  onLinkProject?: (jobId: string, projectId: string) => void;
  onHitlResolved?: () => void;
};

function RowButton({
  node,
  onSelect,
}: {
  node: MapNode;
  onSelect: (id: string) => void;
}) {
  const when = formatMapTime(node.updated_at);
  return (
    <button type="button" onClick={() => onSelect(node.id)} className="w-full rounded-xl px-2 py-2 text-left hover:bg-slate-50">
      <span className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm font-semibold text-slate-800">{node.label}</span>
        {node.urgency && node.urgency !== "idle" ? (
          <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${urgencyPillClass(node.urgency)}`}>
            {MAP_URGENCY_LABELS[node.urgency]}
          </span>
        ) : null}
      </span>
      {node.detail || node.next || node.where ? (
        <span className="mt-0.5 block line-clamp-2 text-[12px] leading-snug text-slate-500">
          {node.detail || node.next || node.where}
        </span>
      ) : null}
      <span className="mt-1 block text-[11px] text-slate-400">
        {(node.who || []).slice(0, 2).join(" · ") || MAP_KIND_LABELS[node.kind]}
        {when ? ` · ${when}` : ""}
      </span>
    </button>
  );
}

function Situation({
  nodes,
  stats,
  onSelect,
}: {
  nodes: MapNode[];
  stats: Props["stats"];
  onSelect: (id: string) => void;
}) {
  const waiting = waitingNodes(nodes).filter((n) => n.kind === "mission" || n.kind === "project");
  const live = activeNodes(nodes);
  return (
    <div className="space-y-4">
      <section>
        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Situation</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" className="rounded-xl bg-amber-50 px-3 py-3 text-left" onClick={() => waiting[0] && onSelect(waiting[0].id)}>
            <p className="text-lg font-extrabold text-amber-950">{stats.waiting ?? waiting.length}</p>
            <p className="text-[11px] font-semibold text-amber-800">À valider</p>
          </button>
          <button type="button" className="rounded-xl bg-emerald-50 px-3 py-3 text-left" onClick={() => live[0] && onSelect(live[0].id)}>
            <p className="text-lg font-extrabold text-emerald-950">{stats.active ?? live.length}</p>
            <p className="text-[11px] font-semibold text-emerald-800">En cours</p>
          </button>
        </div>
      </section>
      {waiting.length ? (
        <section>
          <p className="text-[10px] font-bold uppercase tracking-wide text-amber-800">Traiter maintenant</p>
          <ul className="mt-1.5 space-y-0.5">
            {waiting.slice(0, 8).map((n) => (
              <li key={n.id}>
                <RowButton node={n} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {live.length ? (
        <section>
          <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">En mouvement</p>
          <ul className="mt-1.5 space-y-0.5">
            {live.slice(0, 8).map((n) => (
              <li key={n.id}>
                <RowButton node={n} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="text-sm leading-relaxed text-slate-500">Aucune mission active. Ouvrez une équipe ou une carte pour voir où ça en est.</p>
      )}
    </div>
  );
}

export default function MapInspector({
  node,
  nodes,
  edges,
  nodesById,
  stats,
  layout = "dock",
  deleteBusy,
  linkBusy,
  onSelect,
  onOpen,
  onHide,
  onDelete,
  onLinkProject,
  onHitlResolved,
}: Props) {
  const sheet = layout === "sheet";
  const shell = sheet
    ? "flex h-[min(88dvh,42rem)] min-h-0 flex-col overflow-hidden bg-white"
    : "flex h-full min-h-0 flex-col overflow-hidden border-l border-slate-200 bg-white";

  if (!node) {
    return (
      <aside className={shell}>
        {sheet ? <div className="mobile-sheet-handle" /> : null}
        <header className="border-b border-slate-100 px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Vue d’ensemble</p>
              <h2 className="text-sm font-semibold text-slate-900">Où en est le QG</h2>
            </div>
            {sheet ? (
              <button
                type="button"
                onClick={() => onSelect(null)}
                className="touch-target rounded-lg px-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
              >
                Fermer
              </button>
            ) : null}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 pb-safe">
          <Situation nodes={nodes} stats={stats} onSelect={(id) => onSelect(id)} />
        </div>
      </aside>
    );
  }

  const neighbors = edges
    .filter((e) => e.source === node.id || e.target === node.id)
    .map((e) => {
      const otherId = e.source === node.id ? e.target : e.source;
      return { edge: e, other: nodesById.get(otherId) };
    })
    .filter((x): x is { edge: MapEdge; other: MapNode } => Boolean(x.other && x.other.kind !== "agent"));
  const when = formatMapTime(node.updated_at);
  const openLabel = node.cta?.label || `Ouvrir ${MAP_KIND_LABELS[node.kind].toLowerCase()}`;
  const openHref = node.cta?.href || node.href;
  const jobId = mapNodeJobId(node);
  const showPlanHitl = isMapPlanHitl(node) && Boolean(jobId);
  const projects = [...nodesById.values()]
    .filter((n) => n.kind === "project")
    .sort((a, b) => a.label.localeCompare(b.label, "fr"));
  const linkedProjectIds = new Set(
    neighbors.filter((n) => n.other.kind === "project").map((n) => n.other.id),
  );

  return (
    <aside className={shell}>
      {sheet ? <div className="mobile-sheet-handle" /> : null}
      <header className="border-b border-slate-100 px-4 py-3">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-bold uppercase tracking-wide text-sky-800">{MAP_KIND_LABELS[node.kind]}</p>
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="touch-target rounded-lg px-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
          >
            Fermer
          </button>
        </div>
        <h2 className="mt-0.5 text-base font-semibold leading-snug text-slate-900">{node.label}</h2>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {node.urgency ? (
            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold ${urgencyPillClass(node.urgency)}`}>
              {MAP_URGENCY_LABELS[node.urgency]}
            </span>
          ) : null}
          {when ? <span className="text-[11px] font-medium text-slate-400">{when}</span> : null}
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
        {showPlanHitl ? <MapHitlPanel jobId={jobId} onResolved={onHitlResolved} /> : null}
        {node.detail && !showPlanHitl ? (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">En clair</p>
            <p className="mt-1 leading-relaxed text-slate-800">{node.detail}</p>
          </section>
        ) : null}
        <section>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Où j’en suis</p>
          <p className="mt-1 leading-relaxed text-slate-800">{node.where || "—"}</p>
        </section>
        <section>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Prochaine étape</p>
          <p className="mt-1 leading-relaxed text-slate-800">{node.next || "Rien de planifié."}</p>
        </section>
        <section>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Qui travaille</p>
          {(node.who || []).length ? (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {(node.who || []).map((w) => (
                <li key={w} className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-semibold text-violet-900">
                  {w}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-slate-500">Aucun agent identifié.</p>
          )}
        </section>
        {node.kind === "mission" && onLinkProject && projects.length ? (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Dossier client</p>
            <label className="mt-1 block">
              <span className="sr-only">Rattacher à un dossier</span>
              <select
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800"
                disabled={linkBusy}
                defaultValue=""
                onChange={(e) => {
                  const raw = e.target.value;
                  if (!raw || !jobId) return;
                  const pid = raw.startsWith("project:") ? raw.slice("project:".length) : raw;
                  onLinkProject(jobId, pid);
                  e.target.value = "";
                }}
              >
                <option value="">Rattacher à un dossier…</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id} disabled={linkedProjectIds.has(p.id)}>
                    {p.label}
                    {linkedProjectIds.has(p.id) ? " · déjà lié" : ""}
                  </option>
                ))}
              </select>
            </label>
          </section>
        ) : null}
        {neighbors.length ? (
          <section>
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Relié à</p>
            <ul className="mt-1 space-y-0.5">
              {neighbors.slice(0, 10).map(({ edge, other }) => (
                <li key={`${edge.id}:${other.id}`}>
                  <RowButton node={other} onSelect={(id) => onSelect(id)} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
      <footer className="space-y-2 border-t border-slate-100 p-3 pb-safe">
        {openHref && !showPlanHitl ? (
          onOpen ? (
            <button type="button" className="btn-primary flex w-full justify-center text-sm" onClick={() => onOpen(node)}>
              {openLabel}
            </button>
          ) : (
            <Link href={openHref} className="btn-primary flex w-full justify-center text-sm">
              {openLabel}
            </Link>
          )
        ) : null}
        {showPlanHitl && openHref && onOpen ? (
          <button type="button" className="btn-secondary flex w-full justify-center text-sm" onClick={() => onOpen(node)}>
            Voir dans Décisions
          </button>
        ) : null}
        <div className="flex gap-2">
          {onHide ? (
            <button
              type="button"
              className="btn-secondary flex-1 text-sm"
              onClick={() => onHide(node)}
            >
              Masquer
            </button>
          ) : null}
          {onDelete && canDeleteMapNode(node) ? (
            <button
              type="button"
              disabled={deleteBusy}
              className={`${BTN_DELETE} flex-1`}
              onClick={() => onDelete(node)}
            >
              {deleteBusy ? "Suppression…" : "Supprimer"}
            </button>
          ) : null}
        </div>
      </footer>
    </aside>
  );
}
