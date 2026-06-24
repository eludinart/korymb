import { buildCioDisplayModel } from "./cioResultDisplay";
import { deliverablesForMissionPanel, matchDeliverableTitleToAgentKey } from "./extractTeamDeliverables";
import { normalizeTeamRows, type TeamRow } from "./jobTeam";
import { buildMissionExecutiveBrief } from "./missionExecutiveBrief";
import { stripMarkdownLight } from "./normalizeLooseMarkdown";

export type AgentSuggestionGroup = {
  agentKey: string;
  agentLabel: string;
  items: string[];
};

export type MissionExchangeBriefModel = {
  userConsignes: { ts?: string; excerpt: string }[];
  operationalSummary: string;
  agentSuggestions: AgentSuggestionGroup[];
};

function excerpt(text: string, max = 200): string {
  const clean = stripMarkdownLight(text).replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function bulletsFromMarkdown(md: string): string[] {
  const items: string[] = [];
  for (const line of md.split("\n")) {
    const t = line.trim();
    const m = t.match(/^(?:[-*•]|\d+\.)\s+(.+)$/);
    if (m?.[1] && m[1].length > 8) {
      const body = stripMarkdownLight(m[1]).trim();
      if (body) items.push(body);
    }
  }
  if (items.length) return items;
  const para = excerpt(md, 360);
  return para ? [para] : [];
}

function resolveAgentLabel(agent: string, team: TeamRow[]): string {
  const n = agent.trim().toLowerCase();
  for (const row of team) {
    if (row.key?.toLowerCase() === n) return row.label || row.key || agent;
    if (row.label?.toLowerCase() === n) return row.label;
  }
  return agent.replace(/_/g, " ");
}

function agentKeyFromName(agent: string, team: TeamRow[]): string {
  const n = agent.trim().toLowerCase();
  for (const row of team) {
    if (row.key?.toLowerCase() === n) return row.key;
    if (row.label?.toLowerCase() === n) return row.key || n;
  }
  return n.replace(/\s+/g, "_");
}

function isCioAgent(key: string): boolean {
  const k = key.toLowerCase();
  return k === "coordinateur" || k === "cio";
}

function pushSuggestion(
  map: Map<string, { label: string; items: string[] }>,
  agent: string,
  text: string,
  team: TeamRow[],
) {
  const t = text.trim();
  if (!t || t.length < 10) return;
  const key = agentKeyFromName(agent, team);
  if (isCioAgent(key)) return;
  const label = resolveAgentLabel(agent, team);
  const existing = map.get(key) || { label, items: [] };
  const compact = excerpt(t, 320);
  if (!compact) return;
  const dup = existing.items.some((i) => i.slice(0, 48) === compact.slice(0, 48));
  if (!dup) existing.items.push(compact);
  map.set(key, existing);
}

/** Agrège consignes dirigeant, synthèse et suggestions par agent — sans le verbatim des échanges. */
export function buildMissionExchangeBrief(opts: {
  result?: string | null;
  thread?: unknown;
  team?: unknown;
  deliverablesMarkdown?: string;
  missionBrief?: string | null;
}): MissionExchangeBriefModel {
  const team = normalizeTeamRows(opts.team);
  const map = new Map<string, { label: string; items: string[] }>();
  const userConsignes: { ts?: string; excerpt: string }[] = [];

  const result = String(opts.result || "");
  const model = buildCioDisplayModel(result);
  const execBrief = buildMissionExecutiveBrief(result);

  for (const line of model.operationalBilan) {
    pushSuggestion(map, line.agent, line.text, team);
  }

  const delMd = opts.deliverablesMarkdown || result;
  for (const d of deliverablesForMissionPanel(delMd)) {
    const key = matchDeliverableTitleToAgentKey(d.title, team) || d.title;
    for (const bullet of bulletsFromMarkdown(d.body)) {
      pushSuggestion(map, key, bullet, team);
    }
  }

  for (const row of team) {
    if (row.detail?.trim()) pushSuggestion(map, row.key || row.label || "", row.detail, team);
  }

  const list = Array.isArray(opts.thread) ? opts.thread : [];
  for (const raw of list) {
    if (!raw || typeof raw !== "object") continue;
    const m = raw as { role?: string; content?: string; ts?: string; agent?: string };
    const role = String(m.role || "").toLowerCase();
    const content = String(m.content || "").trim();
    const agent = String(m.agent || "").trim();
    const ts = String(m.ts || "");

    if (role === "user" && content) {
      const ex = excerpt(content, 220);
      if (ex) userConsignes.push({ ts, excerpt: ex });
      continue;
    }

    if (agent && !isCioAgent(agent) && content) {
      const bullets = bulletsFromMarkdown(content);
      if (bullets.length > 1) {
        for (const b of bullets.slice(0, 10)) pushSuggestion(map, agent, b, team);
      } else {
        pushSuggestion(map, agent, content, team);
      }
    }
  }

  if (userConsignes.length === 0 && opts.missionBrief?.trim()) {
    userConsignes.push({ excerpt: excerpt(opts.missionBrief, 220) });
  }

  const agentSuggestions = [...map.entries()]
    .map(([agentKey, v]) => ({ agentKey, agentLabel: v.label, items: v.items }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.agentLabel.localeCompare(b.agentLabel, "fr"));

  let operationalSummary = execBrief?.synthesis?.trim() || "";
  if (!operationalSummary && model.jsonExecutive?.synthesis) {
    operationalSummary = model.jsonExecutive.synthesis.trim();
  }
  if (!operationalSummary) {
    operationalSummary = excerpt(model.ceoDecisionReport, 400);
  }

  return {
    userConsignes,
    operationalSummary,
    agentSuggestions,
  };
}
