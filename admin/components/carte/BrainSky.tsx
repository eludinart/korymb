"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BrainAltitude, MapEdge, MapGap, MapNode } from "../../lib/operationalMap";
import { nodeAttention } from "../../lib/operationalMap";

type Pt = { x: number; y: number; vx: number; vy: number };

const WORLD_W = 1200;
const WORLD_H = 760;

type Props = {
  nodes: MapNode[];
  edges: MapEdge[];
  gaps: MapGap[];
  altitude: BrainAltitude;
  selectedId: string | null;
  query: string;
  onAltitude: (altitude: BrainAltitude) => void;
  onSelect: (id: string | null) => void;
};

function fillFor(node: MapNode): string {
  if (node.kind === "mission") {
    if (node.urgency === "waiting" || node.urgency === "blocked") return "#fbbf24";
    if (node.urgency === "active") return "#fb7185";
    return "#cbd5e1";
  }
  if (node.kind === "team") return "#34d399";
  if (node.kind === "project") return "#67e8f9";
  if (node.kind === "contact") return "#fda4af";
  const kind = String(node.meta?.entity_type || "");
  if (kind === "person") return "#fcd34d";
  if (kind === "place") return "#86efac";
  return "#c4b5fd";
}

function radiusFor(node: MapNode, degree: number): number {
  const attention = nodeAttention(node, degree);
  const base = node.kind === "knowledge" ? 18 : 13;
  const world =
    node.kind === "knowledge" && (node.meta?.entity_type === "person" || node.meta?.entity_type === "project") ? 5 : 0;
  return base + world + attention * 16;
}

function clientToWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const width = rect.width || 1;
  const height = rect.height || 1;
  return {
    x: vb.x + ((clientX - rect.left) / width) * vb.width,
    y: vb.y + ((clientY - rect.top) / height) * vb.height,
  };
}

export default function BrainSky({
  nodes,
  edges,
  gaps,
  altitude,
  selectedId,
  query,
  onAltitude,
  onSelect,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const posRef = useRef<Map<string, Pt>>(new Map());
  const dragId = useRef<string | null>(null);
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState({ x: 0, y: 0, w: WORLD_W, h: WORLD_H });

  const signature = useMemo(() => nodes.map((n) => n.id).sort().join("|"), [nodes]);
  const edgeSignature = useMemo(() => edges.map((e) => e.id).sort().join("|"), [edges]);

  const degree = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of edges) {
      counts.set(edge.source, (counts.get(edge.source) || 0) + 1);
      counts.set(edge.target, (counts.get(edge.target) || 0) + 1);
    }
    return counts;
  }, [edges]);

  const neighborIds = useMemo(() => {
    const ids = new Set<string>();
    if (!selectedId) return ids;
    ids.add(selectedId);
    for (const edge of edges) {
      if (edge.source === selectedId) ids.add(edge.target);
      if (edge.target === selectedId) ids.add(edge.source);
    }
    return ids;
  }, [edges, selectedId]);

  const q = query.trim().toLowerCase();

  useEffect(() => {
    const prev = posRef.current;
    const next = new Map<string, Pt>();
    const cx = WORLD_W / 2;
    const cy = WORLD_H / 2;
    const allFresh = nodes.every((n) => !prev.has(n.id));
    nodes.forEach((node, index) => {
      const kept = prev.get(node.id);
      if (kept && !allFresh) {
        next.set(node.id, kept);
        return;
      }
      const angle = index * 2.399963;
      const radius = 90 + Math.sqrt(index) * 72;
      next.set(node.id, {
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius * 0.7,
        vx: 0,
        vy: 0,
      });
    });
    posRef.current = next;

    let frame = 0;
    let raf = 0;
    const step = () => {
      frame += 1;
      const pos = posRef.current;
      const ids = nodes.map((n) => n.id);
      const held = dragId.current;
      for (let i = 0; i < ids.length; i += 1) {
        const a = pos.get(ids[i]);
        if (!a) continue;
        for (let j = i + 1; j < ids.length; j += 1) {
          const b = pos.get(ids[j]);
          if (!b) continue;
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let dist = Math.hypot(dx, dy) || 0.01;
          const force = dist < 128 ? (128 - dist) * 0.08 : 0;
          dx /= dist;
          dy /= dist;
          if (ids[i] !== held) {
            a.vx += dx * force;
            a.vy += dy * force;
          }
          if (ids[j] !== held) {
            b.vx -= dx * force;
            b.vy -= dy * force;
          }
        }
      }
      for (const edge of edges) {
        const a = pos.get(edge.source);
        const b = pos.get(edge.target);
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.01;
        const rest = edge.inferred ? 200 : 150;
        const mag = (dist - rest) * 0.008;
        const ux = dx / dist;
        const uy = dy / dist;
        if (edge.source !== held) {
          a.vx += ux * mag;
          a.vy += uy * mag;
        }
        if (edge.target !== held) {
          b.vx -= ux * mag;
          b.vy -= uy * mag;
        }
      }
      for (const id of ids) {
        const point = pos.get(id);
        if (!point || id === held) continue;
        point.vx += (cx - point.x) * 0.0011;
        point.vy += (cy - point.y) * 0.0011;
        point.vx *= 0.72;
        point.vy *= 0.72;
        point.x = Math.min(WORLD_W - 110, Math.max(110, point.x + point.vx));
        point.y = Math.min(WORLD_H - 70, Math.max(70, point.y + point.vy));
      }
      if (frame % 2 === 0) setTick((value) => value + 1);
      if (frame < 160) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [edgeSignature, edges, nodes, signature]);

  const zoom = (factor: number) => {
    setView((current) => {
      const w = Math.min(WORLD_W * 1.35, Math.max(420, current.w * factor));
      const h = Math.min(WORLD_H * 1.35, Math.max(280, current.h * factor));
      const cx = current.x + current.w / 2;
      const cy = current.y + current.h / 2;
      return {
        x: Math.min(WORLD_W - w * 0.4, Math.max(-w * 0.2, cx - w / 2)),
        y: Math.min(WORLD_H - h * 0.4, Math.max(-h * 0.2, cy - h / 2)),
        w,
        h,
      };
    });
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const target = event.target as Element | null;
    const nodeEl = target?.closest?.("[data-brain-node]");
    if (nodeEl) {
      const id = nodeEl.getAttribute("data-brain-node") || "";
      dragId.current = id;
      onSelect(id);
      svg.setPointerCapture(event.pointerId);
      return;
    }
    pan.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
    svg.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    if (dragId.current) {
      const point = posRef.current.get(dragId.current);
      if (!point) return;
      const world = clientToWorld(svg, event.clientX, event.clientY);
      point.x = world.x;
      point.y = world.y;
      point.vx = 0;
      point.vy = 0;
      setTick((value) => value + 1);
      return;
    }
    if (!pan.current) return;
    const rect = svg.getBoundingClientRect();
    const dx = ((event.clientX - pan.current.x) / (rect.width || 1)) * view.w;
    const dy = ((event.clientY - pan.current.y) / (rect.height || 1)) * view.h;
    setView((current) => ({ ...current, x: pan.current!.vx - dx, y: pan.current!.vy - dy }));
  };

  const onPointerUp = () => {
    dragId.current = null;
    pan.current = null;
  };

  const drawn = nodes
    .map((node) => {
      const point = posRef.current.get(node.id);
      if (!point) return null;
      return { node, point, r: radiusFor(node, degree.get(node.id) || 0) };
    })
    .filter((item): item is { node: MapNode; point: Pt; r: number } => Boolean(item));

  void tick;

  return (
    <div className="relative min-h-[28rem] flex-1 overflow-hidden bg-[#e8edf7] dark:bg-[#070b18] lg:min-h-0">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-3">
        <div className="pointer-events-auto">
          <p className="text-[10px] font-bold uppercase tracking-wide text-violet-800 dark:text-violet-200/80">Second cerveau</p>
          <p className="mt-0.5 max-w-xs text-xs text-slate-600 dark:text-slate-300">
            Équipes, dossiers et fiches. Gros cercle : touché récemment. Pointillés : rapprochement par le nom.
          </p>
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              onClick={() => onAltitude("fiches")}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                altitude === "fiches"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-0"
              }`}
            >
              Ciel
            </button>
            <button
              type="button"
              onClick={() => onAltitude("autour")}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                altitude === "autour"
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "bg-white text-slate-700 ring-1 ring-slate-200 dark:bg-white/10 dark:text-slate-200 dark:ring-0"
              }`}
            >
              Avec le travail
            </button>
          </div>
        </div>
        <div className="pointer-events-auto flex flex-col gap-1">
          <button type="button" className="rounded-lg bg-white px-2 py-1 text-sm font-bold text-slate-800 ring-1 ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-0" onClick={() => zoom(0.85)} aria-label="Zoomer">
            +
          </button>
          <button type="button" className="rounded-lg bg-white px-2 py-1 text-sm font-bold text-slate-800 ring-1 ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-0" onClick={() => zoom(1.18)} aria-label="Dézoomer">
            −
          </button>
        </div>
      </div>

      {nodes.length === 0 ? (
        <div className="flex h-full min-h-[28rem] items-center justify-center px-6">
          <p className="max-w-sm text-center text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            Le ciel est vide. Les équipes, les dossiers et les fiches du contexte apparaissent ici.
          </p>
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="h-full min-h-[28rem] w-full touch-none lg:min-h-0"
          viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
          role="img"
          aria-label="Constellation du second cerveau"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <rect x={-200} y={-200} width={WORLD_W + 400} height={WORLD_H + 400} className="fill-[#e8edf7] dark:fill-[#070b18]" />
          {edges.map((edge) => {
            const a = posRef.current.get(edge.source);
            const b = posRef.current.get(edge.target);
            if (!a || !b) return null;
            const lit = !selectedId || neighborIds.has(edge.source) && neighborIds.has(edge.target);
            return (
              <line
                key={edge.id}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={edge.inferred ? "stroke-slate-400" : "stroke-violet-500 dark:stroke-violet-200"}
                strokeWidth={edge.inferred ? 1 : 1.6}
                strokeDasharray={edge.inferred ? "5 6" : undefined}
                opacity={lit ? (edge.inferred ? 0.55 : 0.85) : 0.12}
              />
            );
          })}
          {drawn.map(({ node, point, r }) => {
            const match = !q || node.label.toLowerCase().includes(q) || (node.detail || "").toLowerCase().includes(q);
            const lit = (!selectedId || neighborIds.has(node.id)) && match;
            const selected = node.id === selectedId;
            const attention = nodeAttention(node, degree.get(node.id) || 0);
            return (
              <g
                key={node.id}
                data-brain-node={node.id}
                role="button"
                tabIndex={0}
                aria-label={node.label}
                opacity={selected ? 1 : lit ? Math.max(0.55, attention) : 0.16}
                className="cursor-pointer"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node.id);
                  }
                }}
              >
                <circle cx={point.x} cy={point.y} r={r + (selected ? 7 : 3)} fill={fillFor(node)} opacity={selected ? 0.28 : 0.12} />
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={r}
                  fill={fillFor(node)}
                  className={selected ? "stroke-slate-900 dark:stroke-white" : ""}
                  strokeWidth={selected ? 2.5 : 0}
                />
                <text
                  x={point.x}
                  y={point.y + r + 16}
                  textAnchor="middle"
                  fontSize={13}
                  fontWeight={600}
                  strokeWidth={4}
                  paintOrder="stroke"
                  className="fill-slate-800 stroke-[#e8edf7] dark:fill-slate-50 dark:stroke-[#070b18]"
                  style={{ pointerEvents: "none" }}
                >
                  {node.label.length > 28 ? `${node.label.slice(0, 27)}…` : node.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}

      {gaps.length ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-3">
          <div className="pointer-events-auto flex gap-1.5 overflow-x-auto pb-1">
            {gaps.slice(0, 8).map((gap) => (
              <button
                key={gap.id}
                type="button"
                onClick={() => onSelect(gap.node_id)}
                className="shrink-0 rounded-full bg-amber-100/95 px-3 py-1.5 text-left text-[11px] font-bold text-amber-950"
              >
                {gap.reason === "isolated" ? "Sans lien" : "À confirmer"} · {gap.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
