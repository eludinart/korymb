export type MapUrgency = "active" | "waiting" | "blocked" | "done" | "idle";

export type MapNodeKind = "team" | "agent" | "mission" | "project" | "contact" | "knowledge";

export type MapCta = {
  label: string;
  href: string;
};

export type MapNode = {
  id: string;
  kind: MapNodeKind;
  label: string;
  subtitle?: string;
  status?: string;
  urgency?: MapUrgency;
  href?: string;
  where?: string;
  next?: string;
  detail?: string;
  who?: string[];
  cta?: MapCta;
  updated_at?: string;
  meta?: Record<string, unknown>;
};

export type MapEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  label?: string;
};

export type OperationalMapPayload = {
  nodes: MapNode[];
  edges: MapEdge[];
  stats?: {
    teams?: number;
    missions?: number;
    active?: number;
    waiting?: number;
    projects?: number;
    agents?: number;
    knowledge?: number;
  };
  generated_at?: string;
};

export const MAP_KIND_LABELS: Record<MapNodeKind, string> = {
  team: "Équipe",
  agent: "Agent",
  mission: "Mission",
  project: "Projet",
  contact: "Contact",
  knowledge: "Univers",
};

export const MAP_URGENCY_LABELS: Record<MapUrgency, string> = {
  active: "En cours",
  waiting: "À valider",
  blocked: "Bloqué",
  done: "Terminé",
  idle: "Au repos",
};

export const CARD_W = 252;
export const CARD_H = 118;
export const CARD_GAP = 12;
export const CLUSTER_PAD = 14;
export const CLUSTER_HEAD = 58;
export const CLUSTER_GAP_X = 32;
export const CLUSTER_GAP_Y = 36;

export type MapCard = {
  node: MapNode;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type MapCluster = {
  id: string;
  title: string;
  hint: string;
  kind: "team" | "crm" | "knowledge" | "other";
  teamNode?: MapNode;
  x: number;
  y: number;
  w: number;
  h: number;
  agentLabels: string[];
  cards: MapCard[];
};

export type MapBoard = {
  clusters: MapCluster[];
  width: number;
  height: number;
};

const URGENCY_RANK: Record<MapUrgency, number> = {
  blocked: 0,
  waiting: 1,
  active: 2,
  idle: 3,
  done: 4,
};

export function sortMapNodes(nodes: MapNode[]): MapNode[] {
  return [...nodes].sort((a, b) => {
    const ua = URGENCY_RANK[a.urgency || "idle"] ?? 9;
    const ub = URGENCY_RANK[b.urgency || "idle"] ?? 9;
    if (ua !== ub) return ua - ub;
    return (a.label || "").localeCompare(b.label || "", "fr");
  });
}

export function neighborsOf(id: string, edges: MapEdge[]): Set<string> {
  const s = new Set<string>();
  for (const e of edges) {
    if (e.source === id) s.add(e.target);
    if (e.target === id) s.add(e.source);
  }
  return s;
}

export function urgencyDotClass(urgency?: MapUrgency): string {
  if (urgency === "blocked") return "bg-rose-500";
  if (urgency === "waiting") return "bg-amber-500";
  if (urgency === "active") return "bg-emerald-500";
  if (urgency === "done") return "bg-slate-300";
  return "bg-slate-400";
}

export function urgencyAccentClass(urgency?: MapUrgency): string {
  if (urgency === "blocked") return "bg-rose-500";
  if (urgency === "waiting") return "bg-amber-400";
  if (urgency === "active") return "bg-emerald-500";
  if (urgency === "done") return "bg-slate-300";
  return "bg-slate-300";
}

export function urgencyPillClass(urgency?: MapUrgency): string {
  if (urgency === "blocked") return "bg-rose-50 text-rose-800";
  if (urgency === "waiting") return "bg-amber-50 text-amber-900";
  if (urgency === "active") return "bg-emerald-50 text-emerald-900";
  if (urgency === "done") return "bg-slate-100 text-slate-500";
  return "bg-slate-100 text-slate-600";
}

export function clusterTone(kind: MapCluster["kind"]): { wrap: string; head: string } {
  if (kind === "team") {
    return { wrap: "border-sky-200 bg-sky-50/80", head: "text-sky-900" };
  }
  if (kind === "crm") {
    return { wrap: "border-emerald-200 bg-emerald-50/80", head: "text-emerald-900" };
  }
  if (kind === "knowledge") {
    return { wrap: "border-slate-200 bg-white/80", head: "text-slate-700" };
  }
  return { wrap: "border-slate-200 bg-slate-50/90", head: "text-slate-800" };
}

function packCards(nodes: MapNode[], originX: number, originY: number, columns: number): MapCard[] {
  return nodes.map((node, i) => {
    const col = i % columns;
    const row = Math.floor(i / columns);
    return {
      node,
      x: originX + col * (CARD_W + CARD_GAP),
      y: originY + row * (CARD_H + CARD_GAP),
      w: CARD_W,
      h: CARD_H,
    };
  });
}

function clusterSize(cardCount: number, columns: number): { w: number; h: number } {
  if (cardCount <= 0) {
    return { w: CARD_W + CLUSTER_PAD * 2, h: CLUSTER_HEAD + 44 };
  }
  const cols = Math.min(columns, cardCount);
  const rows = Math.ceil(cardCount / columns);
  return {
    w: CLUSTER_PAD * 2 + cols * CARD_W + (cols - 1) * CARD_GAP,
    h: CLUSTER_HEAD + CLUSTER_PAD + rows * CARD_H + (rows - 1) * CARD_GAP + 8,
  };
}

function pushCluster(
  clusters: Omit<MapCluster, "x" | "y">[],
  cluster: Omit<MapCluster, "x" | "y">,
) {
  clusters.push(cluster);
}

function placeClusters(clusters: Omit<MapCluster, "x" | "y">[]): MapBoard {
  const placed: MapCluster[] = [];
  let x = 28;
  let y = 28;
  let rowH = 0;
  const maxRowW = 1280;
  for (const c of clusters) {
    if (x > 28 && x + c.w > maxRowW) {
      x = 28;
      y += rowH + CLUSTER_GAP_Y;
      rowH = 0;
    }
    placed.push({ ...c, x, y });
    x += c.w + CLUSTER_GAP_X;
    rowH = Math.max(rowH, c.h);
  }

  const width = Math.max(
    720,
    placed.reduce((m, c) => Math.max(m, c.x + c.w), 0) + 48,
  );
  const height = Math.max(
    460,
    placed.reduce((m, c) => Math.max(m, c.y + c.h), 0) + 48,
  );

  return { clusters: placed, width, height };
}

function missionTeamMap(edges: MapEdge[]): Map<string, string> {
  const missionTeam = new Map<string, string>();
  for (const e of edges) {
    if (e.kind === "runs" && e.source.startsWith("team:") && e.target.startsWith("mission:")) {
      missionTeam.set(e.target, e.source);
    }
  }
  return missionTeam;
}

function missionProjectMap(edges: MapEdge[]): Map<string, string> {
  const missionProject = new Map<string, string>();
  for (const e of edges) {
    if (e.kind !== "linked") continue;
    if (e.source.startsWith("project:") && e.target.startsWith("mission:")) {
      missionProject.set(e.target, e.source);
    }
    if (e.source.startsWith("mission:") && e.target.startsWith("project:")) {
      missionProject.set(e.source, e.target);
    }
  }
  return missionProject;
}

/** Tableau spatial : cadres d'équipe (ou dossiers clients), cartes de travail — pas de graphe physique. */
export function buildMapBoard(
  nodes: MapNode[],
  edges: MapEdge[],
  opts?: { includeKnowledge?: boolean; groupBy?: "team" | "project" },
): MapBoard {
  const groupBy = opts?.groupBy || "team";
  const teams = nodes.filter((n) => n.kind === "team");
  const missions = nodes.filter((n) => n.kind === "mission");
  const projects = nodes.filter((n) => n.kind === "project");
  const knowledge = opts?.includeKnowledge ? nodes.filter((n) => n.kind === "knowledge") : [];

  if (groupBy === "project") {
    return buildProjectBoard(projects, missions, knowledge, edges);
  }

  const missionTeam = missionTeamMap(edges);
  const usedMissions = new Set<string>();
  const clusters: Omit<MapCluster, "x" | "y">[] = [];

  const teamOrder = [...teams].sort((a, b) => {
    const ae = a.meta?.group_id === "entreprise" ? 0 : 1;
    const be = b.meta?.group_id === "entreprise" ? 0 : 1;
    if (ae !== be) return ae - be;
    return a.label.localeCompare(b.label, "fr");
  });

  for (const team of teamOrder) {
    const owned = sortMapNodes(missions.filter((m) => missionTeam.get(m.id) === team.id));
    owned.forEach((m) => usedMissions.add(m.id));
    const columns = owned.length > 4 ? 2 : 1;
    const size = clusterSize(owned.length, columns);
    pushCluster(clusters, {
      id: team.id,
      title: team.label,
      hint: owned.length ? `${owned.length} mission${owned.length > 1 ? "s" : ""}` : "Aucune mission",
      kind: "team",
      teamNode: team,
      w: Math.max(size.w, CARD_W + CLUSTER_PAD * 2),
      h: size.h,
      agentLabels: (team.who || []).filter(Boolean).slice(0, 8),
      cards: packCards(owned, CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  const orphans = sortMapNodes(missions.filter((m) => !usedMissions.has(m.id)));
  if (orphans.length) {
    const columns = orphans.length > 3 ? 2 : 1;
    const size = clusterSize(orphans.length, columns);
    pushCluster(clusters, {
      id: "cluster:other",
      title: "Autres missions",
      hint: `${orphans.length} sans équipe`,
      kind: "other",
      w: size.w,
      h: size.h,
      agentLabels: [],
      cards: packCards(orphans, CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  if (projects.length) {
    const columns = Math.min(3, Math.max(1, projects.length));
    const size = clusterSize(projects.length, columns);
    pushCluster(clusters, {
      id: "cluster:crm",
      title: "Projets clients",
      hint: `${projects.length} dossier${projects.length > 1 ? "s" : ""}`,
      kind: "crm",
      w: size.w,
      h: size.h,
      agentLabels: [],
      cards: packCards(sortMapNodes(projects), CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  if (knowledge.length) {
    const columns = Math.min(3, Math.max(1, knowledge.length));
    const size = clusterSize(knowledge.length, columns);
    pushCluster(clusters, {
      id: "cluster:knowledge",
      title: "Univers",
      hint: "Graphe de connaissance",
      kind: "knowledge",
      w: size.w,
      h: size.h,
      agentLabels: [],
      cards: packCards(knowledge, CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  return placeClusters(clusters);
}

function buildProjectBoard(
  projects: MapNode[],
  missions: MapNode[],
  knowledge: MapNode[],
  edges: MapEdge[],
): MapBoard {
  const missionProject = missionProjectMap(edges);
  const used = new Set<string>();
  const clusters: Omit<MapCluster, "x" | "y">[] = [];

  for (const project of sortMapNodes(projects)) {
    const owned = sortMapNodes(missions.filter((m) => missionProject.get(m.id) === project.id));
    owned.forEach((m) => used.add(m.id));
    const columns = owned.length > 3 ? 2 : 1;
    const size = clusterSize(owned.length, columns);
    const who = (project.who || []).filter(Boolean);
    pushCluster(clusters, {
      id: project.id,
      title: project.label,
      hint: [project.subtitle, owned.length ? `${owned.length} mission${owned.length > 1 ? "s" : ""}` : "Pas de mission liée"]
        .filter(Boolean)
        .join(" · "),
      kind: "crm",
      teamNode: project,
      w: Math.max(size.w, CARD_W + CLUSTER_PAD * 2),
      h: size.h,
      agentLabels: who.slice(0, 8),
      cards: packCards(owned, CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  const orphans = sortMapNodes(missions.filter((m) => !used.has(m.id)));
  if (orphans.length) {
    const columns = orphans.length > 3 ? 2 : 1;
    const size = clusterSize(orphans.length, columns);
    pushCluster(clusters, {
      id: "cluster:unlinked",
      title: "Missions hors dossier",
      hint: `${orphans.length} non rattachée${orphans.length > 1 ? "s" : ""}`,
      kind: "other",
      w: size.w,
      h: size.h,
      agentLabels: [],
      cards: packCards(orphans, CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  if (knowledge.length) {
    const columns = Math.min(3, knowledge.length);
    const size = clusterSize(knowledge.length, columns);
    pushCluster(clusters, {
      id: "cluster:knowledge",
      title: "Univers",
      hint: "Graphe de connaissance",
      kind: "knowledge",
      w: size.w,
      h: size.h,
      agentLabels: [],
      cards: packCards(knowledge, CLUSTER_PAD, CLUSTER_HEAD, columns),
    });
  }

  return placeClusters(clusters);
}

export function cardWorldRect(cluster: MapCluster, card: MapCard) {
  return { x: cluster.x + card.x, y: cluster.y + card.y, w: card.w, h: card.h };
}

export function waitingNodes(nodes: MapNode[]): MapNode[] {
  return sortMapNodes(nodes.filter((n) => n.urgency === "waiting" || n.urgency === "blocked"));
}

export function activeNodes(nodes: MapNode[]): MapNode[] {
  return sortMapNodes(nodes.filter((n) => n.urgency === "active" && n.kind === "mission"));
}

export function matchesMapQuery(node: { id: string; label: string; detail?: string }, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    node.label.toLowerCase().includes(q) ||
    node.id.toLowerCase().includes(q) ||
    (node.detail || "").toLowerCase().includes(q)
  );
}

export function formatMapTime(iso?: string): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const min = Math.round((Date.now() - t) / 60000);
  if (min < 1) return "à l’instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 14) return `il y a ${d} j`;
  return new Date(t).toLocaleDateString("fr-FR");
}

export function mapNodeJobId(node: MapNode): string {
  if (node.kind !== "mission") return "";
  const fromMeta = node.meta?.job_id;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return node.id.startsWith("mission:") ? node.id.slice("mission:".length) : "";
}

export function mapNodeGroupId(node: MapNode): string {
  if (node.kind !== "team") return "";
  const fromMeta = node.meta?.group_id;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return node.id.startsWith("team:") ? node.id.slice("team:".length) : "";
}

export function isMapPlanHitl(node: MapNode): boolean {
  if (node.kind !== "mission") return false;
  const kind = String(node.meta?.hitl_kind || "");
  if (kind === "cio_question") return false;
  return Boolean(node.meta?.hitl) || node.status === "awaiting_validation";
}

export function mapNodeProjectId(node: MapNode): string {
  if (node.kind !== "project") return "";
  const fromMeta = node.meta?.project_id;
  if (typeof fromMeta === "string" && fromMeta) return fromMeta;
  return node.id.startsWith("project:") ? node.id.slice("project:".length) : "";
}

export function canDeleteMapNode(node: MapNode): boolean {
  return node.kind === "mission" || node.kind === "project";
}

const HIDDEN_KEY = "korymb.carte.hidden";

export function loadHiddenMapIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HIDDEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function saveHiddenMapIds(ids: string[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(ids.slice(0, 400)));
}
