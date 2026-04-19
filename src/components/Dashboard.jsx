import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { API, authHeaders } from "../korymbApi";
import { MemoMarkdown } from "./MemoMarkdown";

const ARCHIVED_FROM_MAIN_KEY = "korymb.missionsArchivedFromMain";

function readArchivedJobIdsFromStorage() {
  try {
    const raw = localStorage.getItem(ARCHIVED_FROM_MAIN_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeArchivedJobIdsToStorage(ids) {
  try {
    localStorage.setItem(ARCHIVED_FROM_MAIN_KEY, JSON.stringify([...ids]));
  } catch {
    /* quota / navigation privée */
  }
}

const CHAT_PERSIST_KEY = "korymb.chatSessions.v1";
const CHAT_HISTORY_MAX = 120;
const CHAT_ROOM_TITLE_MAX = 120;

/** Clés agents autorisées pour le chat (aligné sur le backend / grille UI). */
const CHAT_AGENT_KEYS = new Set([
  "coordinateur",
  "commercial",
  "community_manager",
  "developpeur",
  "comptable",
]);

function isValidChatAgentKey(k) {
  return typeof k === "string" && CHAT_AGENT_KEYS.has(k);
}

/** Exemple aligné sur `backend/llm_tiers.default_llm_tiers_json_example` (OpenRouter). */
const OPENROUTER_TIERS_JSON_EXAMPLE = `{
  "lite": {
    "model": "openai/gpt-4o-mini",
    "price_input_per_million_usd": 0.15,
    "price_output_per_million_usd": 0.6
  },
  "standard": {
    "model": "anthropic/claude-3.5-haiku",
    "price_input_per_million_usd": 0.8,
    "price_output_per_million_usd": 4.0
  },
  "heavy": {
    "model": "anthropic/claude-3.5-sonnet",
    "price_input_per_million_usd": 3.0,
    "price_output_per_million_usd": 15.0
  }
}`;

function newChatRoomId() {
  try {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    /* ignore */
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Forme canonique stockée : { activeRoomId, rooms: { [id]: { title, createdAt, updatedAt, selectedAgent, sessions } } }.
 * Migre l’ancien format { selectedAgent, sessions } (une seule « salle » implicite).
 */
function normalizeChatPersistBlob(raw) {
  const emptyRoom = (title, selAgent, sessions = {}) => ({
    title: typeof title === "string" && title.trim() ? title.trim() : "Conversation",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    selectedAgent: isValidChatAgentKey(selAgent) ? selAgent : "coordinateur",
    sessions: sessions && typeof sessions === "object" ? sessions : {},
  });

  if (!raw || typeof raw !== "object") {
    const id = "default";
    return { activeRoomId: id, rooms: { [id]: emptyRoom("Conversation", "coordinateur", {}) } };
  }

  if (raw.rooms && typeof raw.rooms === "object") {
    const rooms = { ...raw.rooms };
    for (const rid of Object.keys(rooms)) {
      const r = rooms[rid];
      if (!r || typeof r !== "object") {
        delete rooms[rid];
        continue;
      }
      r.sessions = r.sessions && typeof r.sessions === "object" ? r.sessions : {};
      r.selectedAgent = isValidChatAgentKey(r.selectedAgent) ? r.selectedAgent : "coordinateur";
      if (!r.title || typeof r.title !== "string") r.title = "Conversation";
      r.createdAt = typeof r.createdAt === "number" ? r.createdAt : Date.now();
      r.updatedAt = typeof r.updatedAt === "number" ? r.updatedAt : r.createdAt;
    }
    let activeRoomId =
      typeof raw.activeRoomId === "string" && rooms[raw.activeRoomId]
        ? raw.activeRoomId
        : Object.keys(rooms)[0];
    if (!activeRoomId) {
      const id = "default";
      rooms[id] = emptyRoom("Conversation", "coordinateur", {});
      activeRoomId = id;
    }
    return { activeRoomId, rooms };
  }

  const sel = isValidChatAgentKey(raw.selectedAgent) ? raw.selectedAgent : "coordinateur";
  const sessions = raw.sessions && typeof raw.sessions === "object" ? raw.sessions : {};
  const id = "default";
  return {
    activeRoomId: id,
    rooms: {
      [id]: emptyRoom("Conversation", sel, { ...sessions }),
    },
  };
}

function readChatPersistBlob() {
  try {
    const raw = localStorage.getItem(CHAT_PERSIST_KEY);
    if (!raw) return normalizeChatPersistBlob(null);
    const o = JSON.parse(raw);
    return normalizeChatPersistBlob(o);
  } catch {
    return normalizeChatPersistBlob(null);
  }
}

function writeChatPersistBlob(blob) {
  try {
    localStorage.setItem(CHAT_PERSIST_KEY, JSON.stringify(blob));
  } catch {
    /* quota */
  }
}

function clampChatHistory(h) {
  if (!Array.isArray(h)) return [];
  if (h.length <= CHAT_HISTORY_MAX) return h;
  return h.slice(-CHAT_HISTORY_MAX);
}

/** Message navigateur « Failed to fetch » → libellé compréhensible en français. */
function networkErrorMessage(err) {
  const m = err?.message || String(err);
  const proxyHint = import.meta.env.DEV
    ? ` En dev, appels directs vers ${API} (VITE_AI_BACKEND_URL) : uvicorn doit écouter ce port.`
    : ` URL API : ${API}.`;
  if (err?.name === "AbortError" || /aborted|signal/i.test(m)) {
    return "Délai dépassé : le backend ne répond pas." + proxyHint;
  }
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "Connexion au serveur impossible (processus arrêté, mauvais port ou pare-feu)." + proxyHint;
  }
  return m;
}

/** Sonde outils : chemin dédié d’abord, puis /health/tools, puis /health?include_tools=true. */
async function fetchToolsHealthPayload(apiBase, refresh) {
  const qRefresh = refresh ? "?refresh=true" : "";
  const probeTries = [];
  for (const path of ["/probe/web-tools", "/health/tools"]) {
    const res = await fetch(`${apiBase}${path}${qRefresh}`);
    probeTries.push(`GET ${path}${qRefresh || ""} → HTTP ${res.status}`);
    if (res.ok) return res.json();
  }
  const qs = new URLSearchParams({ include_tools: "true" });
  if (refresh) qs.set("refresh_tools", "true");
  const resMain = await fetch(`${apiBase}/health?${qs}`);
  if (resMain.ok) {
    const mainBody = await resMain.json();
    if (mainBody?.tools && typeof mainBody.tools === "object") return mainBody.tools;
  }
  const bits = [...probeTries];
  if (resMain.ok) {
    bits.push(
      "GET /health?include_tools=true → 200 sans objet « tools » : le processus sur ce port n’exécute probablement pas le main.py à jour de ce dépôt (autre dossier, venv ou fenêtre uvicorn).",
    );
  } else {
    bits.push(`GET /health?include_tools=true → HTTP ${resMain.status}.`);
  }
  bits.push(
    "Après sauvegarde : la révision API du bandeau (ex. v3.0.7) doit correspondre à la ligne BACKEND_VERSION de backend/version.py dans ce dépôt. Sinon un autre uvicorn occupe encore le port. PowerShell : cd …\\tarot.app\\backend ; .\\restart.ps1",
  );
  throw new Error(bits.join(" "));
}

/** 404 « Not Found » sur les routes de suppression : backend obsolète ou URL d’API mal alignée (ex. double préfixe /api). */
function apiNotFoundHint(status, detail) {
  if (status !== 404) return null;
  const d = typeof detail === "string" ? detail : "";
  if (d.toLowerCase() === "not found" || !d) {
    return "Le serveur ne connaît pas cette route (404). Redémarre le backend (uvicorn) avec la dernière version du code, ou vérifie VITE_AI_BACKEND_URL (sans suffixe /api sur localhost), VITE_PROXY_TARGET et le proxy Vite.";
  }
  return d;
}

function apiMethodNotAllowedHint(status, detail) {
  if (status !== 405) return null;
  const d = typeof detail === "string" ? detail : "";
  if (/method not allowed|not allowed/i.test(d) || !d) {
    return "Méthode HTTP refusée (405), souvent parce que le proxy n’autorise pas DELETE sur /jobs. Le client retente via POST /run/… — mets le backend à jour pour exposer ces routes.";
  }
  return d;
}

const badMethod = (s) => s === 404 || s === 405;

/** Suppression : POST /jobs → DELETE /jobs → POST /run (selon ce que le proxy accepte). */
async function removeJobFromApi(jobId) {
  const headers = authHeaders();
  const id = encodeURIComponent(jobId);
  let res = await fetch(`${API}/jobs/${id}/remove`, { method: "POST", headers });
  if (badMethod(res.status)) {
    res = await fetch(`${API}/jobs/${id}`, { method: "DELETE", headers });
  }
  if (badMethod(res.status)) {
    res = await fetch(`${API}/run/remove-job`, {
      method: "POST",
      headers,
      body: JSON.stringify({ job_id: jobId }),
    });
  }
  return res;
}

async function validateMissionApi(jobId) {
  const headers = authHeaders();
  const id = encodeURIComponent(jobId);
  let res = await fetch(`${API}/jobs/${id}/validate-mission`, { method: "POST", headers });
  if (badMethod(res.status)) {
    res = await fetch(`${API}/run/validate-mission`, {
      method: "POST",
      headers,
      body: JSON.stringify({ job_id: jobId }),
    });
  }
  if (badMethod(res.status)) {
    res = await fetch(`${API}/jobs/validate-mission`, {
      method: "POST",
      headers,
      body: JSON.stringify({ job_id: jobId }),
    });
  }
  if (badMethod(res.status)) {
    res = await fetch(`${API}/run`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        mission: "",
        agent: "coordinateur",
        user_validate_job_id: jobId,
      }),
    });
  }
  return res;
}

function missionValidateFailureMessage(res, data) {
  const d = data?.detail;
  let msg =
    typeof d === "string"
      ? d
      : Array.isArray(d)
        ? d.map((x) => x.msg || JSON.stringify(x)).join(" ")
        : `Erreur ${res.status}`;
  if (res.status === 404) {
    const hint =
      apiNotFoundHint(res.status, msg) ||
      (String(msg).toLowerCase() === "not found"
        ? "Route de validation absente ou proxy : redémarre le backend Korymb à jour, ou vérifie que POST /api/run/validate-mission atteint FastAPI."
        : null);
    if (hint) msg = hint;
  }
  if (res.status === 405) {
    msg =
      "Le serveur ou le proxy a refusé la méthode POST (405) sur les routes de validation essayées. " +
      "Le client enchaîne jusqu’à POST /run avec user_validate_job_id (souvent la seule variante autorisée). " +
      "Vérifie que le backend Korymb est à jour et que le proxy n’interdit pas POST sur /api/jobs/… ou /api/run/… . " +
      (typeof msg === "string" && msg.length > 0 && msg !== "Method Not Allowed" ? `Détail : ${msg}` : "");
  }
  return msg;
}

async function clearAllJobsApi() {
  const headers = authHeaders();
  let res = await fetch(`${API}/jobs/clear`, { method: "POST", headers });
  if (badMethod(res.status)) {
    res = await fetch(`${API}/jobs`, { method: "DELETE", headers });
  }
  if (badMethod(res.status)) {
    res = await fetch(`${API}/run/clear-jobs`, { method: "POST", headers });
  }
  return res;
}

const ICONS = {
  commercial: "💼", community_manager: "📣",
  developpeur: "💻", comptable: "📊", coordinateur: "🧭",
};

const AGENT_LABELS = {
  coordinateur: "CIO",
  commercial: "Commercial",
  community_manager: "Community manager",
  developpeur: "Développeur",
  comptable: "Comptable",
};

function eventTypeFr(t) {
  const m = {
    mission_start: "Démarrage",
    orchestration_start: "Orchestration",
    plan_parsed: "Plan CIO",
    delegation: "Délégation",
    instruction_delivered: "Consigne reçue",
    sub_agent_working: "Traitement en cours",
    agent_turn_start: "Agent",
    tool_call: "Outil",
    agent_turn_done: "Livrable",
    synthesis_start: "Synthèse",
    synthesis_done: "Synthèse OK",
    mission_done: "Terminé",
    refinement_round: "Affinage CIO",
    error: "Erreur",
    handoff: "Passage de relais",
    team_dialogue: "Échange d’équipe",
    delivery_review: "Contrôle livrable",
  };
  return m[t] || t;
}

/** Livrables textuels par rôle (commercial, dev, etc.) — source de vérité pour « qui a répondu ». */
function extractRoleOutputs(events) {
  const ev = Array.isArray(events) ? events : [];
  return ev
    .filter((e) => e.type === "agent_turn_done" && e.agent)
    .map((e) => ({
      agent: e.agent,
      preview: e.payload?.output_preview || "",
      chars: e.payload?.chars ?? 0,
      ts: e.ts,
    }));
}

/** Étapes de relais (événements `handoff` ou reconstitution depuis le plan). */
function extractInteractionSteps(events, plan) {
  const ev = Array.isArray(events) ? events : [];
  const fromApi = ev
    .filter((e) => e.type === "handoff" && e.payload?.from != null && e.payload?.to != null)
    .map((e) => ({
      from: e.payload.from,
      to: e.payload.to,
      text: e.payload.summary_fr || "",
      ts: e.ts,
      synthetic: false,
    }));
  if (fromApi.length) return fromApi;
  const st = plan?.sous_taches && typeof plan.sous_taches === "object" ? plan.sous_taches : {};
  const keys = Object.keys(st);
  if (!keys.length) return [];
  const out = [];
  out.push({
    from: "coordinateur",
    to: keys[0],
    text: "D’après le plan : le CIO devrait déléguer en premier à ce rôle (rechargement ou ancienne trace sans événements détaillés).",
    synthetic: true,
  });
  for (let i = 1; i < keys.length; i++) {
    out.push({
      from: keys[i - 1],
      to: keys[i],
      text: "D’après le plan : enchaînement prévu entre ces deux rôles.",
      synthetic: true,
    });
  }
  out.push({
    from: keys[keys.length - 1],
    to: "coordinateur",
    text: "D’après le plan : retour des livrables au CIO pour synthèse.",
    synthetic: true,
  });
  return out;
}

const ACTIVITY_EVENT_TYPES = new Set([
  "mission_start",
  "orchestration_start",
  "plan_parsed",
  "delegation",
  "handoff",
  "instruction_delivered",
  "sub_agent_working",
  "agent_turn_start",
  "tool_call",
  "agent_turn_done",
  "synthesis_start",
  "synthesis_done",
  "mission_done",
  "team_dialogue",
  "delivery_review",
]);

function activityEventDetail(e) {
  const p = e.payload || {};
  switch (e.type) {
    case "instruction_delivered":
      return p.instruction_excerpt || p.summary_fr || "";
    case "tool_call":
      return [p.tool, p.name].filter(Boolean).join(" ") || "";
    case "agent_turn_done":
      return p.output_preview || "";
    case "agent_turn_start":
      return p.task_preview || "";
    case "handoff":
      return p.summary_fr || "";
    case "delegation": {
      const to = p.to;
      if (Array.isArray(to) && to.length) return `Rôles : ${to.map((k) => AGENT_LABELS[k] || k).join(", ")}`;
      return p.solo_cio ? "Aucun sous-agent (CIO seul)." : "";
    }
    case "plan_parsed":
      return p.plan?.synthese_attendue ? String(p.plan.synthese_attendue).slice(0, 160) : "";
    case "mission_start":
      return p.preview || "";
    case "mission_done":
      return p.tokens_in != null ? `Tokens ↑${p.tokens_in} ↓${p.tokens_out ?? "?"}` : "";
    case "team_dialogue":
      return p.line_fr || "";
    case "delivery_review": {
      const w = p.warnings;
      if (Array.isArray(w) && w.length) return w.map((x) => String(x).trim()).filter(Boolean).join(" · ");
      return p.level === "warn" ? "Anomalies livrable" : "Contrôle livrable OK";
    }
    default:
      return p.summary_fr || "";
  }
}

/** Dernier avis système sur la conformité du livrable (ex. prospection sans recherche web tracée). */
function extractDeliveryWarnings(jobLike) {
  if (!jobLike) return [];
  const direct = jobLike.delivery_warnings;
  if (Array.isArray(direct) && direct.some((x) => String(x).trim())) {
    return direct.map((x) => String(x).trim()).filter(Boolean);
  }
  const ev = jobLike.events;
  if (!Array.isArray(ev)) return [];
  for (let i = ev.length - 1; i >= 0; i--) {
    const e = ev[i];
    if (e?.type === "delivery_review" && Array.isArray(e.payload?.warnings)) {
      return e.payload.warnings.map((x) => String(x).trim()).filter(Boolean);
    }
  }
  return [];
}

function DeliveryWarningsBanner({ warnings, className = "" }) {
  if (!warnings?.length) return null;
  return (
    <div
      className={`rounded-xl border border-red-200 bg-red-50/95 px-4 py-3 ${className}`}
      role="alert"
    >
      <p className="text-xs font-semibold text-red-900 uppercase tracking-wider mb-1.5 flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-red-600 shrink-0" aria-hidden />
        Livrable à risque (pas de trace des outils attendus)
      </p>
      <ul className="text-xs text-red-950/95 list-disc pl-4 space-y-1">
        {warnings.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
      <p className="text-[10px] text-red-800/85 mt-2 leading-snug">
        Ouvre <strong className="text-red-950">Détails techniques</strong> puis <strong className="text-red-950">Observabilité</strong> : vérifie
        les lignes <code className="font-mono text-[10px]">tool_call</code> pour{" "}
        <code className="font-mono text-[10px]">web_search</code>, <code className="font-mono text-[10px]">read_webpage</code>,{" "}
        <code className="font-mono text-[10px]">search_linkedin</code>.
      </p>
    </div>
  );
}

/** Chronologie lisible des étapes réelles (événements), même sans relais `handoff` matérialisé. */
function extractAgentActivitySignals(events) {
  const ev = Array.isArray(events) ? events : [];
  return ev
    .filter((e) => ACTIVITY_EVENT_TYPES.has(e.type))
    .slice()
    .sort((a, b) => {
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return ta - tb;
    });
}

function extractTeamDialogueLines(events) {
  const ev = Array.isArray(events) ? events : [];
  return ev.filter((e) => e.type === "team_dialogue" && String(e.payload?.line_fr || "").trim());
}

function planSuggestsSubAgents(plan) {
  const agents = plan?.agents;
  if (Array.isArray(agents) && agents.some((k) => k && k !== "coordinateur")) return true;
  const st = plan?.sous_taches;
  if (st && typeof st === "object") {
    return Object.keys(st).some((k) => {
      if (k === "coordinateur" || !AGENT_LABELS[k]) return false;
      return String(st[k] ?? "").trim().length > 0;
    });
  }
  return false;
}

/** Consignes dirigeant + réponses de l’agent principal hors fil d’orchestration interne. */
function filterThreadRowsForLeadExchange(rows, focusAgentKey) {
  if (!Array.isArray(rows)) return [];
  const lead = String(focusAgentKey || "coordinateur").trim() || "coordinateur";
  return rows.filter((row) => {
    if (row.role === "user") return true;
    const agent = String(row.agent || "");
    const src = String(row.source || "");
    if (src.startsWith("orchestration")) return false;
    return agent === lead;
  });
}

/** Journal unique : persistance `mission_thread` + repli sur événements `team_dialogue` (missions avant persistance fil). */
function MissionThreadView({
  thread,
  count,
  events = [],
  plan = {},
  threadMode = "full",
  focusAgent = "coordinateur",
}) {
  const rowsRaw = Array.isArray(thread) ? thread : [];
  const n = typeof count === "number" ? count : rowsRaw.length;
  const legacyDialogue = rowsRaw.length === 0 ? extractTeamDialogueLines(events || []) : [];
  const rows =
    rowsRaw.length > 0
      ? rowsRaw
      : legacyDialogue.map((e) => ({
          ts: e.ts,
          role: "assistant",
          agent: e.agent,
          source: "legacy_events",
          content: String(e.payload?.line_fr || "").trim(),
        }));
  const leadFocus = threadMode === "lead_focus";
  const rowsForDisplay = leadFocus ? filterThreadRowsForLeadExchange(rows, focusAgent) : rows;
  const hasOrchestrationInThread = rowsRaw.some((r) => String(r.source || "").startsWith("orchestration"));
  const showDelegationHint =
    !leadFocus &&
    rows.length === 0 &&
    planSuggestsSubAgents(plan) &&
    !hasOrchestrationInThread &&
    (!Array.isArray(events) || !extractTeamDialogueLines(events).length);
  if (!n && rows.length === 0 && !showDelegationHint) return null;
  const focusLabel = focusAgent === "coordinateur" ? "le CIO" : AGENT_LABELS[focusAgent] || focusAgent;
  const panelTitle = leadFocus ? `Échange avec ${focusLabel}` : "Journal de mission";
  const panelSub = leadFocus
    ? "Tes consignes et les réponses qui te sont adressées. L’enchaînement complet (équipe, relais, orchestration) est dans la section repliable « Enchaînement du processus »."
    : "Orchestration (CIO ↔ rôles), chat lié à cette mission, et échanges enregistrés — un seul fil consultable ici et dans l’historique.";
  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/80 px-3 py-3 mb-3">
      <p className="text-xs font-bold uppercase tracking-wider text-sky-900 mb-0.5">{panelTitle}</p>
      <p className="text-[11px] text-sky-900/85 mb-2 leading-relaxed">{panelSub}</p>
      {showDelegationHint ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-950 leading-relaxed">
          Le plan prévoit des sous-agents, mais aucun message d’équipe n’est encore enregistré. Soit la mission est
          encore au tout début, soit le serveur n’a pas enregistré les événements — ouvre{" "}
          <strong>Détails techniques</strong> pour la trace brute, ou relance une mission avec le backend à jour
          (journal orchestration).
        </div>
      ) : null}
      {leadFocus && rowsForDisplay.length === 0 && rows.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-950 leading-relaxed mb-2">
          Rien à afficher encore dans ton fil direct avec {focusLabel}. L’équipe travaille peut-être en coulisse — ouvre{" "}
          <strong>Enchaînement du processus</strong> pour le journal complet et les relais.
        </div>
      ) : null}
      {rowsForDisplay.length === 0 && n > 0 && !leadFocus ? (
        <p className="text-xs text-sky-900 leading-relaxed">
          {n} message(s) enregistré(s) sur cette mission. Rouvre la carte dans l’onglet Missions ou réaffiche les logs
          pour rafraîchir le fil complet.
        </p>
      ) : rowsForDisplay.length > 0 ? (
        <ol className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {rowsForDisplay.map((row, i) => {
            const isUser = row.role === "user";
            const agent = row.agent || "";
            const label = agent === "dirigeant" ? "Dirigeant" : AGENT_LABELS[agent] || agent;
            const ts = row.ts ? String(row.ts).replace("T", " ").slice(0, 19) : "";
            const src = String(row.source || "");
            const orch = src.startsWith("orchestration");
            const legacy = src === "legacy_events";
            const bubbleOrchestration = orch || legacy;
            return (
              <li
                key={i}
                className={`text-xs rounded-lg border px-2.5 py-2 ${
                  isUser
                    ? "bg-white border-sky-200"
                    : bubbleOrchestration
                      ? "bg-gradient-to-b from-emerald-50/95 to-white border-emerald-200/90 shadow-sm"
                      : "bg-sky-100/80 border-sky-300"
                }`}
              >
                <div className="flex flex-wrap justify-between gap-1 text-[10px] text-sky-800 font-semibold uppercase">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {!isUser && (ICONS[agent] || "🤖")}{" "}
                    <span className={bubbleOrchestration ? "text-emerald-900" : ""}>{label}</span>
                    {src && !legacy ? (
                      <span className="font-normal normal-case text-sky-600 max-w-[10rem] truncate" title={src}>
                        {orch ? "orchestration" : src.replace(/^chat_/, "chat · ")}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono font-normal normal-case text-sky-600">{ts}</span>
                </div>
                <p className="mt-1 text-slate-800 whitespace-pre-wrap leading-relaxed">{row.content || ""}</p>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}

/**
 * Vue lisible des « communications » : en réalité orchestration CIO (séquentielle),
 * matérialisée en chaîne de relais pour le dashboard.
 */
function InteractionFlow({ events, plan }) {
  const ev = Array.isArray(events) ? events : [];
  const steps = extractInteractionSteps(events, plan);
  const roleOutputs = extractRoleOutputs(events);
  const activity = extractAgentActivitySignals(events);
  const soloCio = ev.some((e) => e.type === "delegation" && e.payload?.solo_cio);
  const delegatedTo = ev.find((e) => e.type === "delegation" && Array.isArray(e.payload?.to))?.payload?.to || [];

  const hasFlow = steps.length > 0 || roleOutputs.length > 0 || activity.length > 0;

  if (!hasFlow) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/90 p-4 mb-3">
        <p className="text-xs font-bold uppercase tracking-wider text-slate-600">Flux d’interactions</p>
        {soloCio ? (
          <p className="text-xs text-amber-900 mt-2 leading-relaxed bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            <strong>CIO seul sur ce run :</strong> le plan n’a délégué à aucun sous-agent (pas de ligne « Commercial »
            etc.). Le CIO a donc répondu sans tour commercial. Pour forcer de la prospection / web, formule avec des mots
            type <em>clients, pistes, LinkedIn, marché</em> ou demande explicitement le <strong>commercial</strong>.
          </p>
        ) : ev.length > 0 ? (
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Aucun relais ni livrable intermédiaire pour ce format d’événements. Ouvre{" "}
            <strong>Détails techniques</strong> pour la chronologie brute, ou attends la fin du run.
          </p>
        ) : (
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            Aucun relais ni livrable intermédiaire enregistré pour l’instant. Si la mission est encore en cours, attends
            la fin du tour des rôles ; sinon le CIO a peut-être traité seul.
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-slate-800 bg-gradient-to-br from-slate-900 via-slate-900 to-slate-800 text-white p-4 mb-3 shadow-lg">
      <p className="text-xs font-bold uppercase tracking-widest text-amber-300/95">Flux d’interactions</p>
      <p className="text-[11px] text-slate-400 mt-1.5 mb-4 leading-relaxed">
        Les agents ne s’échangent pas de messages en privé : le <strong className="text-slate-200">CIO orchestre</strong>{" "}
        chaque étape. Les <strong className="text-slate-200">relais</strong> montrent les passages de consigne ; les{" "}
        <strong className="text-slate-200">livrables</strong> montrent l’extrait de réponse de chaque rôle.
      </p>
      {delegatedTo.length > 0 && (
        <p className="text-[11px] text-emerald-200/90 mb-3 font-medium">
          Rôles prévus dans le plan :{" "}
          {delegatedTo.map((k) => (
            <span key={k} className="inline-flex items-center gap-0.5 mr-2">
              {ICONS[k]} {AGENT_LABELS[k] || k}
            </span>
          ))}
        </p>
      )}
      {steps.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-200/80 mb-2">Relais</p>
          <ol className="space-y-5 mb-5">
            {steps.map((s, i) => (
              <li key={i} className="relative pl-6 sm:pl-8 border-l-2 border-amber-500/50 ml-2">
                <span className="absolute -left-[7px] top-0.5 w-3 h-3 rounded-full bg-amber-400 ring-2 ring-slate-900" />
                <div className="flex flex-wrap items-center gap-2 text-[13px] mb-1.5">
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/90 border border-slate-600/50 px-2.5 py-1.5">
                    <span>{ICONS[s.from] || "🤖"}</span>
                    <span className="font-semibold text-slate-100">{AGENT_LABELS[s.from] || s.from}</span>
                  </span>
                  <span className="text-amber-300 font-medium" aria-hidden>
                    →
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-700/90 border border-slate-500/40 px-2.5 py-1.5">
                    <span>{ICONS[s.to] || "🤖"}</span>
                    <span className="font-semibold text-slate-50">{AGENT_LABELS[s.to] || s.to}</span>
                  </span>
                  {s.synthetic ? (
                    <span className="text-[10px] uppercase tracking-wide text-amber-200/80">reconstitué</span>
                  ) : null}
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">{s.text}</p>
              </li>
            ))}
          </ol>
        </>
      )}
      {roleOutputs.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-sky-200/80 mb-2">Livrables (réponses des rôles)</p>
          <ul className="space-y-3">
            {roleOutputs.map((r, i) => (
              <li
                key={i}
                className="rounded-xl border border-slate-600/60 bg-slate-800/60 px-3 py-2.5 text-xs text-slate-200"
              >
                <div className="flex items-center gap-2 font-semibold text-sky-100 mb-1">
                  <span>{ICONS[r.agent] || "🤖"}</span>
                  {AGENT_LABELS[r.agent] || r.agent}
                  {r.chars ? <span className="text-slate-500 font-normal font-mono">· {r.chars} car.</span> : null}
                </div>
                <p className="text-slate-300 leading-relaxed line-clamp-6">{r.preview || "—"}</p>
              </li>
            ))}
          </ul>
        </>
      )}
      {activity.length > 0 && (
        <>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-200/85 mb-2 mt-5">
            Activité (chronologie)
          </p>
          <ol className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
            {activity.map((e, i) => {
              const ag = e.agent;
              const detail = activityEventDetail(e);
              return (
                <li
                  key={`${e.ts || ""}-${e.type}-${i}`}
                  className="rounded-lg border border-slate-600/50 bg-slate-800/40 px-2.5 py-2 text-[11px] text-slate-200"
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {ag ? (
                      <span className="inline-flex items-center gap-1 font-medium text-slate-100">
                        <span>{ICONS[ag] || "🤖"}</span>
                        {AGENT_LABELS[ag] || ag}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    <span className="text-violet-200/90">{eventTypeFr(e.type)}</span>
                    {e.ts ? (
                      <span className="text-slate-500 font-mono text-[10px] ml-auto shrink-0">
                        {new Date(e.ts).toLocaleTimeString()}
                      </span>
                    ) : null}
                  </div>
                  {detail ? (
                    <p className="text-slate-400 mt-1 leading-snug line-clamp-3">{detail}</p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        </>
      )}
      <p className="text-[10px] text-slate-500 mt-4 pt-3 border-t border-slate-700 leading-relaxed">
        Boucles itératives (ex. le CIO relance le commercial après retour du dev) ne sont pas encore dans le moteur : la
        chaîne actuelle est <strong className="text-slate-400">un seul passage</strong> par rôle puis synthèse.
      </p>
    </div>
  );
}

function phaseLabel(phase) {
  const m = { plan: "Plan d’équipe", delegate: "Sous-mission", synth: "Synthèse", work: "Mission" };
  return m[phase] || phase || "";
}

/** Fil d’équipe renvoyé par l’API (statuts mis à jour en direct pendant la mission). */
function TeamTrack({ team }) {
  if (!Array.isArray(team) || team.length === 0) return null;
  const badge = (s) =>
    s === "running"
      ? "border-amber-300 bg-amber-50"
      : s === "done"
        ? "border-emerald-300 bg-emerald-50"
        : "border-slate-200 bg-white";
  const statusWord = (s) =>
    s === "running" ? "En cours" : s === "done" ? "Terminé" : "En attente";
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-3 mb-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
        Qui travaille sur ce sujet
      </p>
      <ol className="space-y-2">
        {team.map((row, i) => (
          <li key={i} className={`rounded-lg border px-3 py-2 text-sm ${badge(row.status)}`}>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-base">{ICONS[row.key] || "🤖"}</span>
              <span className="font-semibold text-slate-800">{row.label}</span>
              {row.phase && (
                <span className="text-[10px] uppercase tracking-wide text-slate-500">
                  · {phaseLabel(row.phase)}
                </span>
              )}
              <span className="ml-auto text-[10px] font-medium text-slate-500 shrink-0">
                {statusWord(row.status)}
              </span>
            </div>
            {row.detail ? (
              <p className="mt-1.5 text-xs text-slate-600 leading-snug border-t border-slate-200/80 pt-1.5">
                {row.detail}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Résumé horizontal : ordre des rôles et phase, sans le texte long des sous-tâches (détail dans le bandeau repliable). */
function MissionProcessPreview({ team, events, plan }) {
  const ev = Array.isArray(events) ? events : [];
  const del = ev.find((e) => e.type === "delegation" && e.payload);
  const delegatedTo = Array.isArray(del?.payload?.to) ? del.payload.to : [];
  const soloCio = Boolean(del?.payload?.solo_cio);
  const pl = plan && typeof plan === "object" ? plan : {};
  const planKeys =
    Array.isArray(pl.agents) && pl.agents.length
      ? pl.agents.filter((k) => AGENT_LABELS[k])
      : pl.sous_taches && typeof pl.sous_taches === "object"
        ? Object.keys(pl.sous_taches).filter((k) => AGENT_LABELS[k] && String(pl.sous_taches[k] ?? "").trim())
        : [];

  const rows = Array.isArray(team) && team.length > 0 ? team : null;

  if (rows?.length) {
    return (
      <div className="rounded-xl border border-indigo-200/90 bg-indigo-50/50 px-3 py-2.5 mb-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-900 mb-2">
          Qui a travaillé · enchaînement
        </p>
        <ol className="m-0 flex list-none flex-wrap items-center gap-x-0.5 gap-y-2 p-0">
          {rows.map((row, i) => (
            <React.Fragment key={`${row.key || "x"}-${i}`}>
              {i > 0 ? (
                <span className="px-1 text-indigo-400 select-none" aria-hidden>
                  →
                </span>
              ) : null}
              <li
                title={row.detail ? String(row.detail).slice(0, 500) : undefined}
                className={`inline-flex max-w-[min(100%,14rem)] items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium ${
                  row.status === "done"
                    ? "border-emerald-300 bg-emerald-50/95 text-emerald-950"
                    : row.status === "running"
                      ? "border-amber-300 bg-amber-50/95 text-amber-950"
                      : "border-slate-200 bg-white text-slate-800"
                }`}
              >
                <span className="shrink-0">{ICONS[row.key] || "🤖"}</span>
                <span className="truncate">{row.label}</span>
                {row.phase ? (
                  <span className="hidden shrink-0 text-[10px] font-normal opacity-80 sm:inline">
                    · {phaseLabel(row.phase)}
                  </span>
                ) : null}
                <span className="shrink-0 text-[10px] font-semibold opacity-90" aria-hidden>
                  {row.status === "done" ? "✓" : row.status === "running" ? "…" : "○"}
                </span>
              </li>
            </React.Fragment>
          ))}
        </ol>
        <p className="mt-2 text-[10px] leading-snug text-indigo-900/80">
          Relais, flux et livrables : bandeau <strong className="text-indigo-950">Enchaînement du processus</strong>.
        </p>
      </div>
    );
  }

  if (soloCio && delegatedTo.length === 0) {
    return (
      <div className="mb-3 rounded-xl border border-amber-200/90 bg-amber-50/60 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-900">Enchaînement</p>
        <p className="mt-1 text-xs text-amber-950/95">
          <strong>CIO seul</strong> sur ce run — aucun sous-agent délégué.
        </p>
      </div>
    );
  }

  if (delegatedTo.length > 0) {
    return (
      <div className="mb-3 rounded-xl border border-indigo-200/90 bg-indigo-50/50 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-900 mb-2">
          Rôles prévus (plan)
        </p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-indigo-950">
          {delegatedTo.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-lg border border-indigo-200 bg-white/90 px-2 py-1"
            >
              {ICONS[k] || "🤖"} {AGENT_LABELS[k] || k}
            </span>
          ))}
        </div>
      </div>
    );
  }

  if (planKeys.length > 0) {
    return (
      <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-600 mb-2">Enchaînement (plan)</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-800">
          {planKeys.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1">
              {ICONS[k] || "🤖"} {AGENT_LABELS[k] || k}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

/** Plan CIO + chronologie d’événements structurés (API v3 observabilité). */
function ObservabilityPanel({ plan, events, defaultOpen = false, compact = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const p = plan && typeof plan === "object" ? plan : {};
  const hasPlan =
    (Array.isArray(p.agents) && p.agents.length > 0) ||
    (p.synthese_attendue && String(p.synthese_attendue).trim()) ||
    (p.sous_taches && Object.keys(p.sous_taches).length > 0);
  const ev = Array.isArray(events) ? events : [];
  if (!hasPlan && ev.length === 0) return null;
  return (
    <div
      className={`rounded-xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50/80 to-white ${
        compact ? "mb-2" : "mb-3"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left cursor-pointer rounded-xl hover:bg-indigo-50/50 transition-colors"
      >
        <span className="text-xs font-semibold text-indigo-900 uppercase tracking-wider">
          Observabilité
          {ev.length > 0 && (
            <span className="ml-2 normal-case font-medium text-indigo-600">
              · {ev.length} événement{ev.length > 1 ? "s" : ""}
            </span>
          )}
        </span>
        <span className="text-indigo-400 text-xs shrink-0">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3 border-t border-indigo-100/80 pt-3">
          {hasPlan && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600/90 mb-1.5">
                Décision / plan
              </p>
              {p.synthese_attendue ? (
                <p className="text-xs text-slate-700 leading-relaxed mb-2 bg-white/80 rounded-lg border border-indigo-100 px-2.5 py-2">
                  <span className="text-slate-500">Synthèse attendue · </span>
                  {p.synthese_attendue}
                </p>
              ) : null}
              {p.sous_taches && Object.keys(p.sous_taches).length > 0 ? (
                <ul className="space-y-1.5">
                  {Object.entries(p.sous_taches).map(([k, txt]) => (
                    <li
                      key={k}
                      className="text-xs rounded-lg border border-slate-200 bg-white px-2.5 py-2 flex gap-2"
                    >
                      <span className="shrink-0">{ICONS[k] || "🤖"}</span>
                      <div>
                        <span className="font-semibold text-slate-800">{k}</span>
                        <p className="text-slate-600 mt-0.5 leading-snug">{String(txt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
          {ev.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-indigo-600/90 mb-1.5">
                Chronologie
              </p>
              <ol className="space-y-2 max-h-72 overflow-y-auto pr-1 border-l-2 border-indigo-200 ml-1.5 pl-3">
                {ev.map((e, i) => (
                  <li key={i} className="relative text-xs">
                    <span className="absolute -left-[14px] top-1.5 w-2 h-2 rounded-full bg-indigo-400 ring-2 ring-white" />
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="font-mono text-[10px] text-slate-400">
                        {(e.ts || "").replace("T", " ").slice(0, 19)}
                      </span>
                      <span className="font-semibold text-indigo-900">{eventTypeFr(e.type)}</span>
                      {e.agent && (
                        <span className="text-slate-600">
                          {ICONS[e.agent] || ""} {e.agent}
                        </span>
                      )}
                    </div>
                    {e.type === "tool_call" && e.payload?.tool ? (
                      <div className="mt-0.5">
                        {e.payload.ok === false ? (
                          <span className="mb-1 inline-flex items-center rounded border border-red-200 bg-red-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-900">
                            Échec outil
                            {e.payload.error_kind ? (
                              <span className="ml-1 font-mono font-normal normal-case text-red-800">
                                {e.payload.error_kind}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                        <p className="text-slate-600 font-mono text-[11px] break-words">
                          <span className="text-indigo-700">{e.payload.tool}</span>
                          {" · "}
                          {e.payload.output_preview ||
                            e.payload.input?.query ||
                            e.payload.input?.url ||
                            e.payload.input?.to ||
                            "…"}
                        </p>
                      </div>
                    ) : null}
                    {e.payload?.task_preview ? (
                      <p className="mt-0.5 text-slate-600 leading-snug">{e.payload.task_preview}</p>
                    ) : null}
                    {e.payload?.output_preview && e.type === "agent_turn_done" ? (
                      <p className="mt-0.5 text-slate-500 leading-snug line-clamp-3">{e.payload.output_preview}</p>
                    ) : null}
                    {e.payload?.message && e.type === "error" ? (
                      <p className="mt-0.5 text-red-600">{e.payload.message}</p>
                    ) : null}
                    {e.type === "delivery_review" && Array.isArray(e.payload?.warnings) && e.payload.warnings.length ? (
                      <ul className="mt-0.5 text-red-800 text-[11px] list-disc pl-4 space-y-0.5">
                        {e.payload.warnings.map((w, wi) => (
                          <li key={wi}>{w}</li>
                        ))}
                      </ul>
                    ) : null}
                    {e.payload?.to && e.type === "delegation" ? (
                      <p className="mt-0.5 text-slate-600">
                        {(e.payload.to || []).map((k) => (
                          <span key={k} className="inline-flex items-center gap-0.5 mr-2">
                            {ICONS[k]} {k}
                          </span>
                        ))}
                        {e.payload.solo_cio ? <span className="text-amber-700">CIO seul</span> : null}
                      </p>
                    ) : null}
                    {e.type === "handoff" && e.payload?.summary_fr ? (
                      <p className="mt-0.5 text-slate-600 leading-snug">
                        {ICONS[e.payload.from] || "🤖"} → {ICONS[e.payload.to] || "🤖"} {e.payload.summary_fr}
                      </p>
                    ) : null}
                    {e.type === "refinement_round" && e.payload?.phase ? (
                      <p className="mt-0.5 text-slate-600 text-[11px]">
                        Tour {e.payload.round} · {e.payload.phase}
                        {e.payload.critique_preview ? (
                          <span className="block text-slate-500 mt-0.5 font-mono break-words">
                            {e.payload.critique_preview}
                          </span>
                        ) : null}
                        {e.payload.output_preview ? (
                          <span className="block text-slate-500 mt-0.5 font-mono break-words">
                            {e.payload.output_preview}
                          </span>
                        ) : null}
                      </p>
                    ) : null}
                    {(e.type === "instruction_delivered" || e.type === "sub_agent_working") &&
                    e.payload?.summary_fr ? (
                      <p className="mt-0.5 text-slate-600 leading-snug">{e.payload.summary_fr}</p>
                    ) : null}
                    {e.type === "instruction_delivered" && e.payload?.instruction_excerpt ? (
                      <p className="mt-0.5 text-slate-500 text-[11px] leading-snug font-mono break-words">
                        {e.payload.instruction_excerpt}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Widgets ─────────────────────────────────────────────────────────────────

function StatusDot({ status, title }) {
  const cfg = {
    ok:      { dot: "bg-emerald-500", text: "text-emerald-700", label: "Connecté" },
    error:   { dot: "bg-red-500",     text: "text-red-700",     label: "Inaccessible" },
    loading: { dot: "bg-amber-400 animate-pulse", text: "text-amber-700", label: "…" },
  };
  const { dot, text, label } = cfg[status] || cfg.loading;
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${text}`} title={title || undefined}>
      <span className={`w-2 h-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}

function TokenWidget({ tokens }) {
  if (!tokens) return null;
  const pct = Math.min(100, Math.round((tokens.total / tokens.max_per_job) * 100));
  const color = tokens.budget_exceeded ? "bg-red-500"
              : tokens.alert           ? "bg-amber-400"
              : "bg-emerald-500";
  const usageOn = Boolean(tokens.usage_events_active);
  const costDayLine = usageOn
    ? `$${Number(tokens.cost_today_usd ?? 0).toFixed(4)} aujourd’hui (API)`
    : `$${tokens.cost_usd} aujourd’hui`;
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-2">
      <div>
        <div className="font-semibold text-slate-700">{tokens.total.toLocaleString()} tokens</div>
        <div className="text-slate-400">{costDayLine}</div>
        {usageOn && Number(tokens.cost_total_usd) > 0 ? (
          <div className="text-[10px] text-slate-400 mt-0.5">
            Total facturé ${Number(tokens.cost_total_usd).toFixed(4)} · dernière h. $
            {Number(tokens.cost_last_hour_usd ?? 0).toFixed(4)}
          </div>
        ) : null}
        {!usageOn ? (
          <div className="text-[10px] text-slate-400 mt-0.5">Estimation (compteur local)</div>
        ) : null}
      </div>
      <div className="w-16">
        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
        </div>
        <div className={`text-xs mt-0.5 text-right font-medium ${tokens.alert ? "text-amber-600" : "text-slate-400"}`}>
          {pct}%
        </div>
      </div>
      {tokens.alert && <span className="text-amber-500 text-base">⚠️</span>}
    </div>
  );
}

/** Avertit quand le palier « lourd » (boucles outils / recherche) est nettement plus cher que le léger. */
function ResearchTierCostBanner({ tokens }) {
  if (!tokens?.expensive_research_tier) return null;
  return (
    <div
      className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
      role="status"
    >
      <p className="font-semibold text-amber-900">Recherche et outils : palier coûteux</p>
      <p className="text-xs mt-1.5 leading-relaxed text-amber-900/95">
        La configuration actuelle des paliers OpenRouter indique un modèle « lourd » sensiblement plus cher que le
        palier léger. Les boucles d&apos;outils (web, pages) utilisent ce palier : surveillez la consommation ou
        ajustez le JSON des paliers dans l&apos;onglet Configuration.
      </p>
    </div>
  );
}

/** Bandeau global : outils web indisponibles ou sonde injoignable. */
function ToolsConnectivityBanner({ data, fetchError, onRecheck }) {
  if (fetchError) {
    return (
      <div
        className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 shadow-sm"
        role="status"
      >
        <p className="font-semibold text-amber-900">Sonde outils web</p>
        <p className="text-xs mt-1 leading-relaxed space-y-1">
          <span className="block">
            Impossible d&apos;exécuter la sonde des outils web. Chemins :{" "}
            <code className="font-mono text-[11px]">/probe/web-tools</code>
            <span className="mx-1">·</span>
            <code className="font-mono text-[11px]">/health/tools</code>
            <span className="mx-1">·</span>
            <code className="font-mono text-[11px]">/health?include_tools=true</code>
          </span>
          <span className="block text-amber-900/90 font-mono text-[11px] mt-1">{fetchError}</span>
        </p>
        {typeof onRecheck === "function" ? (
          <button
            type="button"
            onClick={onRecheck}
            className="mt-2 text-xs font-medium text-amber-950 underline-offset-2 hover:underline cursor-pointer"
          >
            Réessayer
          </button>
        ) : null}
      </div>
    );
  }
  if (!data) return null;
  const ws = data.web_search;
  const rw = data.read_webpage;
  if (ws?.ok && rw?.ok) return null;
  return (
    <div
      className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-sm text-red-950 shadow-sm"
      role="alert"
    >
      <p className="font-semibold text-red-900 flex flex-wrap items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-full bg-red-600 shrink-0" aria-hidden />
        Outils web : accès dégradé ou bloqué
      </p>
      <ul className="mt-2 text-xs list-disc pl-4 space-y-1">
        {!ws?.ok ? (
          <li>
            <strong>Recherche web</strong> ({ws?.provider || "duckduckgo"}) :{" "}
            {ws?.message || "échec ou fournisseur injoignable."}{" "}
            <span className="text-slate-600">(LinkedIn public via DDG suit le même état.)</span>
          </li>
        ) : null}
        {!rw?.ok ? (
          <li>
            <strong>Lecture de page HTTP</strong> : {rw?.message || "impossible d’atteindre une page de test."}
          </li>
        ) : null}
      </ul>
      <p className="text-[11px] text-red-900/85 mt-2 leading-snug">
        Les missions prospection / veille peuvent renvoyer des erreurs côté agent. Vérifie le réseau sortant, un proxy
        <code className="mx-0.5 font-mono text-[10px]">HTTP_PROXY</code>, ou installe / met à jour{" "}
        <code className="font-mono text-[10px]">duckduckgo-search</code> sur le serveur.
      </p>
      {typeof onRecheck === "function" ? (
        <button
          type="button"
          onClick={onRecheck}
          className="mt-2 text-xs font-semibold bg-red-900 text-white px-3 py-1.5 rounded-lg hover:bg-red-950 cursor-pointer"
        >
          Retester maintenant
        </button>
      ) : null}
      {data.checked_at ? (
        <p className="text-[10px] text-red-800/80 mt-2 font-mono">
          Dernière sonde : {String(data.checked_at).replace("T", " ").slice(0, 19)}
          {data.cached ? ` · cache ${data.cache_age_s ?? "?"}s` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Bloc Configuration : état détaillé des sondes (OK + bouton retest). */
function ToolsConnectivityConfigCard({ data, fetchError, busy, onRetest }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Outils web (hors LLM)</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => onRetest?.()}
          className="text-xs font-medium bg-slate-900 text-white px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
        >
          {busy ? "Test…" : "Retester"}
        </button>
      </div>
      {fetchError ? (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{fetchError}</p>
      ) : null}
      {!data && !fetchError ? <p className="text-xs text-slate-500">Chargement de la sonde…</p> : null}
      {data ? (
        <ul className="text-xs space-y-2 text-slate-700">
          <li className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-slate-800">Recherche web (DuckDuckGo)</span>
            <span className={data.web_search?.ok ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>
              {data.web_search?.ok ? "OK" : "Indisponible ou erreur"}
            </span>
            {!data.web_search?.ok && data.web_search?.message ? (
              <span className="block w-full text-red-600/95 font-mono text-[10px] leading-snug">
                {String(data.web_search.message).slice(0, 280)}
              </span>
            ) : null}
          </li>
          <li className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-slate-800">Lecture page HTTP</span>
            <span className={data.read_webpage?.ok ? "text-emerald-700 font-medium" : "text-red-700 font-medium"}>
              {data.read_webpage?.ok ? "OK" : "Échec"}
            </span>
            {!data.read_webpage?.ok && data.read_webpage?.message ? (
              <span className="block w-full text-red-600/95 font-mono text-[10px] leading-snug">
                {String(data.read_webpage.message).slice(0, 280)}
              </span>
            ) : null}
          </li>
          <li className="text-slate-500">
            <span className="font-semibold text-slate-700">LinkedIn (DDG)</span> — même pile que la recherche web (
            {data.search_linkedin?.ok ? "déduit OK" : "déduit KO"}).
          </li>
        </ul>
      ) : null}
      {data?.checked_at ? (
        <p className="text-[10px] text-slate-500 font-mono">
          Sonde : {String(data.checked_at).replace("T", " ").slice(0, 19)}
          {data.cached ? ` · cache ~${data.cache_ttl_s ?? 120}s` : ""}
        </p>
      ) : null}
    </div>
  );
}

// ── Onglet Configuration LLM ─────────────────────────────────────────────────
function ConfigTab({ onSaved }) {
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");
  const [ok, setOk]             = useState("");
  const [provider, setProvider] = useState("anthropic");
  const [model, setModel]       = useState("");
  const [snapshot, setSnapshot] = useState(null);
  const [toolsProbe, setToolsProbe] = useState(null);
  const [toolsProbeErr, setToolsProbeErr] = useState("");
  const [toolsProbeBusy, setToolsProbeBusy] = useState(false);
  const [llmTiersJson, setLlmTiersJson] = useState("");

  const [memLoading, setMemLoading] = useState(true);
  const [memSaving, setMemSaving] = useState(false);
  const [memErr, setMemErr] = useState("");
  const [memOk, setMemOk] = useState("");
  const [memCtx, setMemCtx] = useState({
    global: "",
    commercial: "",
    community_manager: "",
    developpeur: "",
    comptable: "",
  });

  const load = useCallback(async () => {
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/admin/settings`, { headers: authHeaders() });
      if (res.status === 403) {
        const j = await res.json().catch(() => ({}));
        const d = typeof j.detail === "string" ? j.detail : "";
        throw new Error(
          d
            ? `${d} Même valeur que VITE_AGENT_SECRET (racine) et AGENT_API_SECRET (backend/.env).`
            : "Accès refusé (403). Vérifie VITE_AGENT_SECRET (racine) et AGENT_API_SECRET (backend/.env).",
        );
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || `Erreur ${res.status}`);
      }
      const d = await res.json();
      setSnapshot(d);
      setLlmTiersJson(typeof d.llm_tiers_json === "string" ? d.llm_tiers_json : "");
      const p = d.llm_provider === "openrouter" ? "openrouter" : "anthropic";
      setProvider(p);
      setModel(
        p === "openrouter"
          ? String(d.openrouter_model || "")
          : String(d.anthropic_model || ""),
      );
    } catch (e) {
      setErr(networkErrorMessage(e) || String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchToolsProbe = useCallback(async (refresh) => {
    setToolsProbeBusy(true);
    setToolsProbeErr("");
    try {
      setToolsProbe(await fetchToolsHealthPayload(API, refresh));
    } catch (e) {
      setToolsProbeErr(networkErrorMessage(e) || String(e));
      setToolsProbe(null);
    } finally {
      setToolsProbeBusy(false);
    }
  }, []);

  const loadMemory = useCallback(async () => {
    setMemErr("");
    setMemOk("");
    setMemLoading(true);
    try {
      const res = await fetch(`${API}/memory`, { headers: authHeaders() });
      if (res.status === 403) {
        const j = await res.json().catch(() => ({}));
        const d = typeof j.detail === "string" ? j.detail : "";
        throw new Error(
          d
            ? `${d} Même valeur que VITE_AGENT_SECRET (racine) et AGENT_API_SECRET (backend/.env).`
            : "Accès refusé (403). Vérifie VITE_AGENT_SECRET (racine) et AGENT_API_SECRET (backend/.env).",
        );
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail || `Erreur ${res.status}`);
      }
      const d = await res.json();
      const c = d.contexts || {};
      setMemCtx({
        global: String(c.global || ""),
        commercial: String(c.commercial || ""),
        community_manager: String(c.community_manager || ""),
        developpeur: String(c.developpeur || ""),
        comptable: String(c.comptable || ""),
      });
    } catch (e) {
      setMemErr(networkErrorMessage(e) || String(e));
    } finally {
      setMemLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadMemory();
  }, [load, loadMemory]);

  useEffect(() => {
    fetchToolsProbe(false);
  }, [fetchToolsProbe]);

  const submit = async e => {
    e.preventDefault();
    setErr("");
    setOk("");
    setSaving(true);
    try {
      const body = { llm_provider: provider };
      if (provider === "anthropic") body.anthropic_model = model.trim();
      else {
        body.openrouter_model = model.trim();
        body.llm_tiers_json = llmTiersJson;
      }
      const res = await fetch(`${API}/admin/settings`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || `Erreur ${res.status}`);
      setOk("Configuration enregistrée.");
      setSnapshot(j);
      setLlmTiersJson(typeof j.llm_tiers_json === "string" ? j.llm_tiers_json : "");
      if (provider === "anthropic") setModel(String(j.anthropic_model || model));
      else setModel(String(j.openrouter_model || model));
      onSaved?.();
    } catch (e) {
      setErr(networkErrorMessage(e) || String(e));
    } finally {
      setSaving(false);
    }
  };

  const submitMemory = async (e) => {
    e.preventDefault();
    setMemErr("");
    setMemOk("");
    setMemSaving(true);
    try {
      const res = await fetch(`${API}/memory`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ contexts: memCtx }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.detail || `Erreur ${res.status}`);
      const c = j.contexts || {};
      setMemCtx({
        global: String(c.global || ""),
        commercial: String(c.commercial || ""),
        community_manager: String(c.community_manager || ""),
        developpeur: String(c.developpeur || ""),
        comptable: String(c.comptable || ""),
      });
      setMemOk("Mémoire entreprise enregistrée.");
      onSaved?.();
    } catch (e) {
      setMemErr(networkErrorMessage(e) || String(e));
    } finally {
      setMemSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Chargement de la configuration…</p>;

  return (
    <div className="flex flex-col gap-10 max-w-3xl">
      <ToolsConnectivityConfigCard
        data={toolsProbe}
        fetchError={toolsProbeErr}
        busy={toolsProbeBusy}
        onRetest={() => fetchToolsProbe(true)}
      />
      <div className="flex flex-col gap-4 max-w-xl">
      <p className="text-sm text-slate-600">
        Choix du <strong>fournisseur</strong> et du <strong>modèle</strong> utilisés par Korymb (missions, chat).
        Les valeurs sont enregistrées sur le serveur (<code className="text-xs bg-slate-100 px-1 rounded">runtime_settings.json</code>) et complètent le <code className="text-xs bg-slate-100 px-1 rounded">.env</code>.
      </p>
      {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">{err}</p>}
      {ok && <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">{ok}</p>}

      <form onSubmit={submit} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Fournisseur d’IA
          </label>
          <select
            value={provider}
            onChange={e => {
              const p = e.target.value;
              setProvider(p);
              if (snapshot) {
                setModel(
                  p === "openrouter"
                    ? String(snapshot.openrouter_model || "")
                    : String(snapshot.anthropic_model || ""),
                );
              }
            }}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm bg-slate-50 outline-none focus:border-slate-400"
          >
            <option value="anthropic">Anthropic (API directe)</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
            Modèle
          </label>
          <input
            type="text"
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm font-mono bg-slate-50 outline-none focus:border-slate-400"
            placeholder={
              provider === "openrouter"
                ? "ex. openai/gpt-4o-mini, google/gemini-2.0-flash-001…"
                : "ex. claude-sonnet-4-6"
            }
          />
          <p className="text-xs text-slate-400 mt-2">
            {provider === "openrouter"
              ? "Identifiant tel qu’affiché sur openrouter.ai (liste des modèles)."
              : "Identifiant modèle côté API Anthropic Messages."}
          </p>
        </div>
        {provider === "openrouter" ? (
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Paliers OpenRouter (JSON)
            </label>
            <textarea
              value={llmTiersJson}
              onChange={(ev) => setLlmTiersJson(ev.target.value)}
              rows={14}
              spellCheck={false}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono bg-slate-50 outline-none focus:border-slate-400 resize-y min-h-[200px]"
              placeholder='{ "lite": { "model": "...", "price_input_per_million_usd": 0, "price_output_per_million_usd": 0 }, ... }'
            />
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <button
                type="button"
                onClick={() => setLlmTiersJson(OPENROUTER_TIERS_JSON_EXAMPLE)}
                className="text-xs font-medium text-slate-700 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50 cursor-pointer"
              >
                Insérer un exemple
              </button>
              <button
                type="button"
                onClick={() => setLlmTiersJson("")}
                className="text-xs text-slate-500 hover:text-slate-800 cursor-pointer"
              >
                Vider
              </button>
            </div>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              Clés recommandées : <code className="font-mono text-[11px]">lite</code>,{" "}
              <code className="font-mono text-[11px]">standard</code>,{" "}
              <code className="font-mono text-[11px]">heavy</code> — avec tarifs USD / million de tokens pour le suivi
              des coûts. Laisse vide pour n&apos;utiliser que le modèle unique et les tarifs par défaut.
            </p>
            {snapshot?.tier_routing?.expensive_research_tier ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                Indicateur actuel : palier lourd nettement plus cher que le léger (recherche / outils).
              </p>
            ) : null}
          </div>
        ) : null}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || !model.trim()}
            className="bg-slate-900 text-white text-sm font-medium px-6 py-2.5 rounded-xl hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
          >
            {saving ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            type="button"
            onClick={() => load()}
            className="text-sm text-slate-600 border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-50 cursor-pointer"
          >
            Recharger
          </button>
        </div>
      </form>
      </div>

      <div className="max-w-3xl">
        <p className="text-sm text-slate-600 mb-3">
          <strong>Mémoire entreprise</strong> : texte persisté en base, injecté dans les prompts du{" "}
          <strong>CIO</strong> (vue globale + périmètres par rôle) et des <strong>sous-agents</strong> (extrait global +
          leur volet). Les missions terminées alimentent aussi un fil court de missions récentes.
        </p>
        {memErr && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3 mb-3">{memErr}</p>
        )}
        {memOk && (
          <p className="text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 mb-3">
            {memOk}
          </p>
        )}
        {memLoading ? (
          <p className="text-sm text-slate-400">Chargement de la mémoire…</p>
        ) : (
          <form onSubmit={submitMemory} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            {[
              ["global", "Contexte global (entreprise)"],
              ["commercial", "Commercial"],
              ["community_manager", "Community manager"],
              ["developpeur", "Développeur"],
              ["comptable", "Comptable"],
            ].map(([key, label]) => (
              <div key={key}>
                <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
                  {label}
                </label>
                <textarea
                  value={memCtx[key]}
                  onChange={(ev) => setMemCtx((prev) => ({ ...prev, [key]: ev.target.value }))}
                  rows={key === "global" ? 6 : 4}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800 focus:ring-2 focus:ring-slate-300 outline-none resize-y min-h-[88px]"
                  placeholder="Notes stables pour ce volet…"
                />
              </div>
            ))}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="submit"
                disabled={memSaving}
                className="bg-slate-900 text-white text-sm font-medium px-6 py-2.5 rounded-xl hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
              >
                {memSaving ? "Enregistrement…" : "Enregistrer la mémoire"}
              </button>
              <button
                type="button"
                onClick={() => loadMemory()}
                className="text-sm text-slate-600 border border-slate-200 rounded-xl px-4 py-2.5 hover:bg-slate-50 cursor-pointer"
              >
                Recharger la mémoire
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Onglets ─────────────────────────────────────────────────────────────────
function Tabs({ active, onChange }) {
  const tabs = [["missions", "Suivi"], ["chat", "Chat"], ["history", "Historique"], ["config", "Configuration"]];
  return (
    <div className="flex flex-wrap gap-0 border-b border-slate-200">
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer
            ${active === key ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function truncateOneline(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/** Aligné sur le backend : sous-agents en file après délégation = `pending`, tour actif = `running`. */
function teamRowIsActiveForDashboard(row) {
  const s = String(row?.status || "").toLowerCase();
  return s === "running" || s === "pending";
}

/** Lignes d’activité par clé d’agent (missions `running` côté API). */
function buildAgentActivityByKey(runningJobs) {
  const by = {};
  const push = (key, line) => {
    if (!key) return;
    if (!by[key]) by[key] = [];
    if (!by[key].includes(line)) by[key].push(line);
  };
  for (const job of runningJobs) {
    const mission = truncateOneline(job.mission || "", 96);
    const tag = job.job_id ? `#${job.job_id}` : "?";
    const team = Array.isArray(job.team) ? job.team : [];
    if (team.length === 0) {
      push(job.agent, `${tag} · ${mission}`);
      continue;
    }
    let anyActive = false;
    for (const row of team) {
      if (!teamRowIsActiveForDashboard(row)) continue;
      anyActive = true;
      const det = truncateOneline(row.detail || mission, 88);
      const pend = String(row.status || "").toLowerCase() === "pending";
      const hint = pend ? " (en file / prochain tour)" : "";
      push(row.key, `${tag} · ${det}${hint}`);
    }
    if (!anyActive && job.agent) {
      push(job.agent, `${tag} · ${mission}`);
    }
  }
  return by;
}

/** Tâches structurées par agent (missions `running`) pour la vue d’ensemble. */
function buildAgentTaskRows(runningJobs) {
  const by = {};
  const push = (key, task) => {
    if (!key || !task?.jobId) return;
    if (!by[key]) by[key] = [];
    const sig = `${task.jobId}|${task.title}|${task.subtitle || ""}`;
    if (by[key].some((t) => `${t.jobId}|${t.title}|${t.subtitle || ""}` === sig)) return;
    by[key].push(task);
  };
  for (const job of runningJobs) {
    const mission = String(job.mission || "").trim();
    const jid = job.job_id != null ? String(job.job_id) : "";
    const team = Array.isArray(job.team) ? job.team : [];
    if (team.length === 0) {
      push(job.agent, {
        jobId: jid,
        title: mission || "Mission en cours",
        subtitle: null,
      });
      continue;
    }
    let anyActive = false;
    for (const row of team) {
      if (!teamRowIsActiveForDashboard(row)) continue;
      anyActive = true;
      const det = String(row.detail || "").trim();
      const pend = String(row.status || "").toLowerCase() === "pending";
      push(row.key, {
        jobId: jid,
        title: det || mission || "Tâche en cours",
        subtitle: pend
          ? "Rôle assigné dans le plan — en file jusqu’au passage effectif (le statut passe à « en cours » pendant l’appel modèle)."
          : det && mission && det !== mission
            ? mission
            : null,
      });
    }
    if (!anyActive && job.agent) {
      push(job.agent, {
        jobId: jid,
        title: mission || "Mission en cours",
        subtitle: "Équipe : aucun rôle « en cours » ou « en file » sur ce cliché API",
      });
    }
  }
  return by;
}

function MissionTokensStrip({ snapshot }) {
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">
        Chargement des compteurs tokens…
      </div>
    );
  }
  const day =
    typeof snapshot.total === "number"
      ? snapshot.total
      : (Number(snapshot.tokens_in) || 0) + (Number(snapshot.tokens_out) || 0);
  const life =
    typeof snapshot.lifetime_tokens_total === "number" ? snapshot.lifetime_tokens_total : day;
  const inflight = typeof snapshot.tokens_inflight === "number" ? snapshot.tokens_inflight : 0;
  const usageOn = Boolean(snapshot.usage_events_active);
  const cell = (label, value, hint) => (
    <div className="min-w-[7.5rem] flex-1">
      <p className="font-semibold uppercase tracking-wide text-slate-400 text-[10px]">{label}</p>
      <p className="text-sm font-mono font-semibold text-slate-900 tabular-nums">{value.toLocaleString()}</p>
      {hint ? <p className="text-[10px] text-slate-500 mt-0.5 leading-snug">{hint}</p> : null}
    </div>
  );
  return (
    <div className="flex flex-wrap items-stretch gap-3 sm:gap-4 rounded-xl border border-slate-200 bg-slate-50/90 px-3 py-2.5 text-xs text-slate-600">
      {cell("Total", life, "Toutes missions enregistrées + avancement live")}
      <div className="hidden sm:block w-px bg-slate-200 self-stretch min-h-[2.5rem]" />
      {cell("Journalier", day, snapshot.today ? `Journée ${snapshot.today}` : "Tous appels du jour")}
      <div className="hidden sm:block w-px bg-slate-200 self-stretch min-h-[2.5rem]" />
      {cell("En cours", inflight, "Missions « running » (tokens déjà comptés)")}
      {usageOn ? (
        <>
          <div className="hidden sm:block w-px bg-slate-200 self-stretch min-h-[2.5rem]" />
          {cell(
            "API (mois)",
            `$${Number(snapshot.cost_month_usd ?? 0).toFixed(2)}`,
            "Coût USD agrégé (llm_usage_events)",
          )}
          <div className="hidden sm:block w-px bg-slate-200 self-stretch min-h-[2.5rem]" />
          {cell(
            "API (7 j)",
            `$${Number(snapshot.cost_week_usd ?? 0).toFixed(2)}`,
            "Fenêtre glissante 7 jours",
          )}
        </>
      ) : null}
    </div>
  );
}

function useAgentWorkloadPoll() {
  const [pollJobs, setPollJobs] = useState([]);
  const [pollTokens, setPollTokens] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [jobRes, tokRes] = await Promise.all([
          fetch(`${API}/jobs`, { headers: authHeaders() }),
          fetch(`${API}/tokens`),
        ]);
        if (cancelled) return;
        if (jobRes.ok) {
          const j = await jobRes.json();
          setPollJobs(j.jobs || []);
        }
        if (tokRes.ok) setPollTokens(await tokRes.json());
      } catch {
        if (!cancelled) setPollJobs([]);
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);
  const runningForGrid = useMemo(
    () => pollJobs.filter((j) => j.status === "running"),
    [pollJobs],
  );
  const activityByAgent = useMemo(
    () => buildAgentActivityByKey(runningForGrid),
    [runningForGrid],
  );
  return { activityByAgent, tokensSnapshot: pollTokens, jobs: pollJobs };
}

// ── Sélecteur d'agent ────────────────────────────────────────────────────────
function AgentGrid({ agents, selected, onSelect, activityByAgent, tokensSnapshot }) {
  const showStrip = tokensSnapshot !== undefined;
  return (
    <div className="space-y-3">
      {showStrip && <MissionTokensStrip snapshot={tokensSnapshot} />}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 items-stretch">
        {agents.map((a) => {
          const lines = activityByAgent?.[a.key] || [];
          const busy = lines.length > 0;
          return (
            <button
              key={a.key}
              type="button"
              onClick={() => onSelect(a.key)}
              className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all cursor-pointer h-full
            ${
              selected === a.key
                ? "bg-slate-900 border-slate-900 text-white shadow-md"
                : "bg-white border-slate-200 hover:border-slate-400"
            }`}
            >
              <span className="text-xl">{ICONS[a.key] || "🤖"}</span>
              <span className={`text-sm font-semibold mt-1 ${selected === a.key ? "text-white" : "text-slate-800"}`}>
                {a.label}
              </span>
              <span className={`text-xs ${selected === a.key ? "text-slate-400" : "text-slate-400"}`}>{a.role}</span>
              {a.is_manager && (
                <span
                  className={`text-xs font-medium mt-1 px-1.5 py-0.5 rounded-full w-fit
              ${selected === a.key ? "bg-slate-700 text-slate-200" : "bg-amber-100 text-amber-700"}`}
                >
                  orchestrateur
                </span>
              )}
              {busy ? (
                <div
                  className={`mt-auto pt-2 border-t w-full space-y-1 ${
                    selected === a.key ? "border-slate-600/70" : "border-slate-200"
                  }`}
                >
                  <span
                    className={`text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1 ${
                      selected === a.key ? "text-amber-300" : "text-amber-700"
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 animate-pulse" />
                    En activité
                  </span>
                  {lines.slice(0, 2).map((line, i) => (
                    <p
                      key={i}
                      className={`text-[11px] leading-snug line-clamp-2 ${
                        selected === a.key ? "text-slate-300" : "text-slate-600"
                      }`}
                    >
                      {line}
                    </p>
                  ))}
                  {lines.length > 2 ? (
                    <p className={`text-[10px] ${selected === a.key ? "text-slate-500" : "text-slate-400"}`}>
                      +{lines.length - 2} autre{lines.length - 2 > 1 ? "s" : ""}
                    </p>
                  ) : null}
                </div>
              ) : (
                <span className="mt-auto" aria-hidden />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Terminal logs ────────────────────────────────────────────────────────────
function LogPanel({ jobId, isRunning, onUpdate }) {
  const [logs, setLogs]   = useState([]);
  const offsetRef         = useRef(0);
  const logsScrollRef     = useRef(null);

  useEffect(() => {
    let stopped = false;
    const ac = new AbortController();
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${API}/jobs/${jobId}?log_offset=${offsetRef.current}`, {
          headers: authHeaders(),
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = await res.json();
        if (typeof data.log_total === "number") {
          if (Array.isArray(data.logs) && data.logs.length > 0) {
            setLogs((p) => [...p, ...data.logs]);
          }
          offsetRef.current = data.log_total;
        }
        onUpdate(data);
        if (data.status === "running" && !stopped) setTimeout(poll, 1500);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!stopped) setTimeout(poll, 2000);
      }
    };
    poll();
    return () => {
      stopped = true;
      ac.abort();
    };
  }, [jobId]);

  useEffect(() => {
    const el = logsScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [logs]);

  const lineColor = l =>
    l.startsWith("[korymb] Mission démarrée") ? "text-sky-400" :
    l.includes("terminée") || l.startsWith("✓") ? "text-emerald-400" :
    l.startsWith("[korymb] Erreur") || l.includes("⚠️") ? "text-red-400" :
    l.includes("tokens") ? "text-violet-400" :
    (l.includes("[CIO →") || l.includes("→ CIO]")) ? "text-cyan-300" :
    "text-slate-300";

  return (
    <div className="mt-3 rounded-xl bg-[#0d1117] overflow-hidden border border-slate-800">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-800">
        <span className="w-3 h-3 rounded-full bg-red-500/70"/><span className="w-3 h-3 rounded-full bg-amber-400/70"/><span className="w-3 h-3 rounded-full bg-emerald-500/70"/>
        <span className="ml-2 text-xs text-slate-500 font-mono">#{jobId}</span>
        {isRunning && <span className="ml-auto text-xs text-amber-400 animate-pulse">live</span>}
      </div>
      <div
        ref={logsScrollRef}
        className="p-4 max-h-64 overflow-y-auto overflow-x-hidden font-mono text-xs leading-relaxed min-h-0"
      >
        {logs.length===0
          ? <span className="text-slate-600">En attente de sortie…</span>
          : logs.map((l,i) => <div key={i} className={lineColor(l)}>{l}</div>)
        }
        <p className="mt-2 text-[10px] text-slate-500 leading-snug border-t border-slate-800 pt-2">
          Les lignes <span className="text-cyan-400/90">[CIO → …]</span> et{" "}
          <span className="text-cyan-400/90">[… → CIO]</span> reprennent le fil oral ; le détail structuré est aussi sous{" "}
          <strong className="text-slate-400">Flux d’interactions</strong> et <strong className="text-slate-400">Observabilité</strong>.
        </p>
      </div>
    </div>
  );
}

/** Logs, observabilité et métriques : reste monté (sr-only) pour que le polling live continue quand c’est replié. */
function MissionJobTechnicalBlock({ job, setJob, isRunning }) {
  const [open, setOpen] = useState(false);
  const src = job.source || "mission";
  const mc = job.mission_config || {};
  const reqUserVal = mc.require_user_validation !== false;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/90 overflow-hidden">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-100/80 cursor-pointer transition-colors"
      >
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-800">Détails techniques</p>
          <p className="text-xs text-slate-500 mt-0.5 leading-snug">
            Logs moteur, trace observabilité, coût tokens et paramètres d&apos;exécution — ouvre ce panneau pour
            diagnostiquer ou auditer le run.
          </p>
        </div>
        <span className="text-slate-400 text-sm shrink-0" aria-hidden>
          {open ? "▼" : "▶"}
        </span>
      </button>
      <div className={open ? "border-t border-slate-200" : "sr-only"}>
        <div className="px-4 py-4 space-y-4">
          {(job.tokens_total > 0 || Number(job.cost_usd) > 0) && (
            <p className="text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Métriques :</span>{" "}
              <span className="font-mono">{job.tokens_total?.toLocaleString() || 0} tok</span>
              {job.cost_usd != null && (
                <>
                  {" "}
                  · <span className="font-mono">${job.cost_usd}</span>
                </>
              )}
              {job.token_alert ? <span className="text-amber-700 font-medium"> · alerte budget</span> : null}
            </p>
          )}
          {src === "mission" ? (
            <p className="text-[11px] text-slate-600 leading-snug bg-white/80 rounded-lg border border-slate-100 px-3 py-2">
              <span className="font-semibold text-slate-700">Réglages : </span>
              {mc.recursive_refinement_enabled ? (
                <span>
                  affinage CIO jusqu’à <strong>{Number(mc.recursive_max_rounds) || 0}</strong> tour
                  {(Number(mc.recursive_max_rounds) || 0) > 1 ? "s" : ""}
                </span>
              ) : (
                <span>pas d’affinage récursif</span>
              )}
              {" · "}
              {reqUserVal ? (
                <span>validation dirigeant requise</span>
              ) : (
                <span>
                  <strong>pas</strong> de validation dirigeant (auto-clôture)
                </span>
              )}
            </p>
          ) : null}
          <ObservabilityPanel plan={job.plan} events={job.events} defaultOpen={false} />
          <LogPanel
            jobId={job.job_id}
            isRunning={isRunning}
            onUpdate={(d) =>
              setJob((j) => ({
                ...j,
                status: d.status,
                tokens_in: d.tokens_in,
                tokens_out: d.tokens_out,
                tokens_total: d.tokens_total,
                cost_usd: d.cost_usd,
                token_alert: d.token_alert,
                result: d.result,
                team: Array.isArray(d.team) ? d.team : j.team,
                plan: d.plan != null ? d.plan : j.plan,
                events: d.events != null ? d.events : j.events,
                delivery_warnings: Array.isArray(d.delivery_warnings)
                  ? d.delivery_warnings
                  : j.delivery_warnings,
                source: d.source || j.source,
                user_validated_at: d.user_validated_at != null ? d.user_validated_at : j.user_validated_at,
                mission_closed_by_user:
                  d.mission_closed_by_user != null ? d.mission_closed_by_user : j.mission_closed_by_user,
                mission_config: d.mission_config != null ? d.mission_config : j.mission_config,
                mission_thread: Array.isArray(d.mission_thread) ? d.mission_thread : j.mission_thread,
                mission_thread_count:
                  typeof d.mission_thread_count === "number" ? d.mission_thread_count : j.mission_thread_count,
              }))}
          />
        </div>
      </div>
    </div>
  );
}

/** Bandeau repliable fiable (évite les bugs des <details> natifs / clics imbriqués). */
function CollapsibleBand({
  bandId,
  title,
  subtitle,
  open,
  onToggle,
  className = "",
  bodyClassName = "px-4 pb-4 border-t border-slate-100 bg-slate-50/50",
  children,
}) {
  return (
    <div className={className}>
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <button
          type="button"
          id={`${bandId}-toggle`}
          aria-expanded={open}
          aria-controls={`${bandId}-body`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onToggle();
          }}
          className="w-full px-4 py-3 flex items-start justify-between gap-3 text-left hover:bg-slate-50/90 cursor-pointer"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-800">{title}</span>
            {subtitle ? (
              <span className="block text-xs text-slate-500 mt-0.5 font-normal leading-snug">{subtitle}</span>
            ) : null}
          </span>
          <span className="shrink-0 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1 select-none">
            {open ? "Réduire" : "Développer"}
          </span>
        </button>
        {open ? (
          <div id={`${bandId}-body`} role="region" aria-labelledby={`${bandId}-toggle`} className={bodyClassName}>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Carte job ────────────────────────────────────────────────────────────────
function JobCard({ job: init, highlight = false, onArchiveFromMain, onMissionValidated }) {
  const [job, setJob] = useState(() => ({
    ...init,
    plan: init.plan || {},
    events: init.events || [],
    delivery_warnings: Array.isArray(init.delivery_warnings) ? init.delivery_warnings : [],
    source: init.source || "mission",
    user_validated_at: init.user_validated_at || null,
    mission_closed_by_user: init.mission_closed_by_user || false,
    mission_config: init.mission_config || {},
    mission_thread: Array.isArray(init.mission_thread) ? init.mission_thread : [],
    mission_thread_count:
      typeof init.mission_thread_count === "number"
        ? init.mission_thread_count
        : (Array.isArray(init.mission_thread) ? init.mission_thread.length : 0),
  }));
  const [acceptChecked, setAcceptChecked] = useState(false);
  const [validateBusy, setValidateBusy] = useState(false);
  const [validateErr, setValidateErr] = useState("");
  const [openMissionBand, setOpenMissionBand] = useState(false);
  const [openProcessBand, setOpenProcessBand] = useState(false);

  useEffect(() => {
    setJob((prev) => ({
      ...prev,
      user_validated_at: init.user_validated_at ?? prev.user_validated_at,
      mission_closed_by_user: init.mission_closed_by_user ?? prev.mission_closed_by_user,
      status: init.status ?? prev.status,
      mission_config: init.mission_config ?? prev.mission_config,
      delivery_warnings: Array.isArray(init.delivery_warnings) ? init.delivery_warnings : prev.delivery_warnings,
    }));
  }, [
    init.user_validated_at,
    init.mission_closed_by_user,
    init.status,
    init.mission_config,
    init.delivery_warnings,
  ]);

  useEffect(() => {
    setAcceptChecked(false);
    setValidateErr("");
    setOpenMissionBand(false);
    setOpenProcessBand(false);
  }, [init.job_id, init.user_validated_at]);

  const statusStr = String(job.status ?? "");
  const isRunning = job.status === "running";
  const isError = statusStr.startsWith("error");
  const src = job.source || "mission";
  const userClosed = !!(job.user_validated_at || job.mission_closed_by_user);
  const mc = job.mission_config || {};
  const reqUserVal = mc.require_user_validation !== false;
  const needsMissionUserValidation =
    job.status === "completed" && !isError && src === "mission" && !userClosed && reqUserVal;
  const missionAwaitingUser = needsMissionUserValidation;
  const statusCls = isRunning
    ? "bg-amber-100 text-amber-700"
    : isError
      ? "bg-red-100 text-red-700"
      : missionAwaitingUser
        ? "bg-sky-100 text-sky-900"
        : "bg-emerald-100 text-emerald-700";
  const statusLabel = isRunning
    ? "En cours"
    : isError
      ? "Erreur"
      : missionAwaitingUser
        ? "À valider"
        : job.status === "completed" && src === "mission" && userClosed
          ? "Clôturée"
          : "Terminé";
  const deliveryWarnings = useMemo(() => extractDeliveryWarnings(job), [job.events, job.delivery_warnings]);
  const showArchiveCta =
    typeof onArchiveFromMain === "function" &&
    ((job.status === "completed" && userClosed) || isError);

  const submitValidate = async () => {
    if (!acceptChecked || validateBusy) return;
    setValidateBusy(true);
    setValidateErr("");
    try {
      const res = await validateMissionApi(job.job_id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(missionValidateFailureMessage(res, data));
      }
      const iso = data.user_validated_at || new Date().toISOString();
      setJob((j) => ({ ...j, user_validated_at: iso, mission_closed_by_user: true }));
      onMissionValidated?.(job.job_id, iso);
    } catch (e) {
      setValidateErr(e.message || "Validation impossible.");
    } finally {
      setValidateBusy(false);
    }
  };

  return (
    <div
      data-job-card={job.job_id}
      className={`bg-white border rounded-2xl p-5 shadow-sm transition-shadow ${
        highlight ? "border-violet-500 ring-2 ring-violet-400/70 shadow-md" : "border-slate-200"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl shrink-0">{ICONS[job.agent] || "🤖"}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800">{job.agent}</span>
              <span className="font-mono text-xs text-slate-400">#{job.job_id}</span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Consigne et déroulé d&apos;équipe : <strong className="text-slate-600">sections repliables</strong>.{" "}
              Métriques et logs : <strong className="text-slate-600">Détails techniques</strong> en bas de carte.
            </p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full shrink-0 ${statusCls}`}>{statusLabel}</span>
      </div>

      <DeliveryWarningsBanner warnings={deliveryWarnings} className="mt-3" />

      {job.parent_job_id ? (
        <p className="mt-3 text-[11px] text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 leading-relaxed">
          <strong className="text-slate-800">Suivi CIO</strong> lié à la mission d’origine{" "}
          <Link
            to={`/dashboard?tab=history&historyJob=${encodeURIComponent(job.parent_job_id)}`}
            className="font-mono text-violet-800 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            #{job.parent_job_id}
          </Link>
          . Voir la <strong className="text-slate-700">chaîne</strong> dans l’onglet Historique (lien parent / suivis).
        </p>
      ) : null}

      {needsMissionUserValidation && (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/90 px-4 py-3 space-y-3">
          <p className="text-xs text-amber-950 leading-relaxed">
            <strong className="text-amber-900">Pipeline terminé</strong> : l’équipe et le CIO ont produit une synthèse.
            Pour toi, la mission n’est <strong>finie</strong> qu’après ta validation explicite. En attendant, tu peux{" "}
            <strong>poursuivre la discussion avec le CIO</strong> (itération, précisions) depuis le chat — le résultat
            ci-dessous sera repris comme contexte.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/dashboard?tab=chat&followJob=${encodeURIComponent(job.parent_job_id || job.job_id)}`}
              className="inline-flex items-center text-sm font-medium bg-white text-amber-950 border border-amber-300 px-4 py-2 rounded-lg hover:bg-amber-100 cursor-pointer"
            >
              Poursuivre avec le CIO
            </Link>
          </div>
          <div className="border-t border-amber-200/80 pt-3 space-y-2">
            <label className="flex items-start gap-2 text-xs text-amber-950 cursor-pointer">
              <input
                type="checkbox"
                checked={acceptChecked}
                onChange={(e) => setAcceptChecked(e.target.checked)}
                className="mt-0.5 rounded border-amber-400"
              />
              <span>
                Je considère que cette mission est satisfaisante : le CIO a bien réceptionné les livrables, je n’ai pas
                besoin d’autres allers-retours pour l’instant.
              </span>
            </label>
            {validateErr ? <p className="text-xs text-red-700">{validateErr}</p> : null}
            <button
              type="button"
              disabled={!acceptChecked || validateBusy}
              onClick={submitValidate}
              className="text-sm font-medium bg-amber-900 text-white px-4 py-2 rounded-lg hover:bg-amber-950 disabled:opacity-40 cursor-pointer"
            >
              {validateBusy ? "Enregistrement…" : "Valider et clôturer la mission"}
            </button>
          </div>
        </div>
      )}

      {showArchiveCta && (
        <div className="mt-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-600 leading-relaxed">
            {job.status === "completed" ? (
              <>
                Mission <strong className="text-slate-800">validée par toi</strong>. Tu peux relire la synthèse puis
                retirer cette carte du formulaire (les logs restent dans l’historique et sous{" "}
                <strong className="text-slate-800">Détails techniques</strong>).
              </>
            ) : (
              <>
                Cette exécution s’est terminée en <strong className="text-slate-800">erreur</strong> ; le diagnostic est
                sous <strong className="text-slate-800">Détails techniques</strong>.
              </>
            )}{" "}
            L’archivage ne supprime rien : la mission reste consultable dans l’onglet{" "}
            <strong className="text-slate-800">Historique</strong>.
          </p>
          <button
            type="button"
            onClick={() => onArchiveFromMain(job.job_id)}
            className="shrink-0 text-sm font-medium bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 cursor-pointer"
          >
            Archiver (retirer d’ici)
          </button>
        </div>
      )}

      {job.result && !isRunning && (
        <div className="mt-4 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Synthèse (résultat)</p>
          <MemoMarkdown content={job.result} className="prose prose-sm prose-slate max-w-none" />
        </div>
      )}

      <MissionProcessPreview team={job.team} events={job.events} plan={job.plan} />

      <MissionThreadView
        thread={job.mission_thread}
        count={job.mission_thread_count}
        events={job.events}
        plan={job.plan}
        threadMode="lead_focus"
        focusAgent={job.agent}
      />

      <CollapsibleBand
        className="mt-3"
        bandId={`korymb-job-${job.job_id}-mission`}
        title="Consigne / mission demandée"
        subtitle="Texte initial envoyé à l’équipe."
        open={openMissionBand}
        onToggle={() => setOpenMissionBand((v) => !v)}
        bodyClassName="px-4 pb-4 border-t border-slate-100 bg-slate-50/50"
      >
        <p className="text-sm text-slate-900 whitespace-pre-wrap leading-relaxed pt-3">{job.mission || "—"}</p>
      </CollapsibleBand>

      <CollapsibleBand
        className="mt-2"
        bandId={`korymb-job-${job.job_id}-process`}
        title="Enchaînement du processus"
        subtitle="Flux, équipe et journal complet — l’aperçu des rôles est au-dessus du journal."
        open={openProcessBand}
        onToggle={() => setOpenProcessBand((v) => !v)}
        bodyClassName="px-4 pb-4 border-t border-slate-100 space-y-3 pt-3 bg-slate-50/40"
      >
        <TeamTrack team={job.team} />
        <InteractionFlow events={job.events} plan={job.plan} />
        <MissionThreadView
          thread={job.mission_thread}
          count={job.mission_thread_count}
          events={job.events}
          plan={job.plan}
          threadMode="full"
          focusAgent={job.agent}
        />
      </CollapsibleBand>

      <MissionJobTechnicalBlock job={job} setJob={setJob} isRunning={isRunning} />
    </div>
  );
}

// ── Onglet Missions ──────────────────────────────────────────────────────────
/** `launch` : formulaire seul (page Mission). `tracking` : suivi des exécutions (page Dashboard). */
function MissionsTab({ agents, highlightJobId, agentWorkload, mode = "tracking", initialAgentKey }) {
  const navigate = useNavigate();
  const [selectedAgent, setSelectedAgent] = useState(initialAgentKey || "coordinateur");
  const [mission, setMission]             = useState("");
  const [jobs, setJobs]                   = useState([]);
  const [sending, setSending]             = useState(false);
  const [error, setError]                 = useState("");
  const [mcRecursive, setMcRecursive]     = useState(false);
  const [mcRounds, setMcRounds]           = useState(1);
  const [mcRequireValidation, setMcRequireValidation] = useState(true);
  const currentAgent = agents.find(a => a.key === selectedAgent);

  useEffect(() => {
    if (!initialAgentKey || !agents?.length) return;
    if (agents.some((a) => a.key === initialAgentKey)) setSelectedAgent(initialAgentKey);
  }, [initialAgentKey, agents]);

  const [archivedFromMain, setArchivedFromMain] = useState(() => readArchivedJobIdsFromStorage());

  const archiveFromMain = useCallback((jobId) => {
    setArchivedFromMain((prev) => {
      const next = new Set(prev);
      next.add(jobId);
      writeArchivedJobIdsToStorage(next);
      return next;
    });
  }, []);

  const markMissionValidated = useCallback((jobId, iso) => {
    setJobs((prev) =>
      prev.map((x) =>
        x.job_id === jobId
          ? { ...x, user_validated_at: iso, mission_closed_by_user: true }
          : x,
      ),
    );
  }, []);

  const missionsOnMainForm = useMemo(
    () => jobs.filter((j) => !archivedFromMain.has(j.job_id)),
    [jobs, archivedFromMain],
  );

  useEffect(() => {
    fetch(`${API}/jobs`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { jobs: [] }))
      .then((d) => {
        const remote = (d.jobs || []).map((j) => ({
          job_id: j.job_id,
          status: j.status,
          agent: j.agent,
          mission: j.mission,
          result: null,
          team: j.team || [],
          plan: {},
          events: [],
          delivery_warnings: Array.isArray(j.delivery_warnings) ? j.delivery_warnings : [],
          source: j.source || "mission",
          user_validated_at: j.user_validated_at || null,
          mission_closed_by_user: !!j.mission_closed_by_user,
          mission_config: j.mission_config || {},
          mission_thread: Array.isArray(j.mission_thread) ? j.mission_thread : [],
          mission_thread_count: typeof j.mission_thread_count === "number" ? j.mission_thread_count : 0,
        }));
        setJobs((prev) => {
          const m = new Map(remote.map((x) => [x.job_id, x]));
          for (const p of prev) {
            if (!m.has(p.job_id)) m.set(p.job_id, p);
          }
          return Array.from(m.values());
        });
      })
      .catch(() => {});
  }, [highlightJobId]);

  const handleSubmit = async e => {
    e.preventDefault();
    if (!mission.trim()) return;
    setError(""); setSending(true);
    try {
      const rounds = mcRecursive ? Math.min(5, Math.max(0, parseInt(String(mcRounds), 10) || 0)) : 0;
      const mission_config = {
        recursive_refinement_enabled: mcRecursive,
        recursive_max_rounds: rounds,
        require_user_validation: mcRequireValidation,
      };
      const res = await fetch(`${API}/run`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          mission: mission.trim(),
          agent: selectedAgent,
          mission_config,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(()=>({}))).detail || `Erreur ${res.status}`);
      const data = await res.json();
      if (mode === "launch") {
        navigate(`/dashboard?tab=missions&job=${encodeURIComponent(data.job_id)}`);
      } else {
        setJobs((p) => [
          {
            job_id: data.job_id,
            status: "running",
            agent: data.agent,
            mission: mission.trim(),
            result: null,
            team: [],
            plan: {},
            events: [],
            delivery_warnings: [],
            source: "mission",
            user_validated_at: null,
            mission_closed_by_user: false,
            mission_config,
            mission_thread: [],
            mission_thread_count: 0,
          },
          ...p,
        ]);
        setMission("");
      }
    } catch(err) { setError(err.message); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      {mode === "tracking" && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-sm text-slate-700">
          <span className="text-slate-600">Nouvelle exécution ou cadrage préalable :</span>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/mission/nouvelle"
              className="inline-flex items-center justify-center text-sm font-medium bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
            >
              Lancer une mission
            </Link>
            <Link
              to="/mission/guided"
              className="inline-flex items-center justify-center text-sm font-medium bg-violet-900 text-white px-4 py-2 rounded-lg hover:bg-violet-800 transition-colors"
            >
              Mission guidée
            </Link>
          </div>
        </div>
      )}

      {mode === "launch" && (
        <>
          <div className="rounded-xl border border-violet-200 bg-violet-50/80 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <p className="text-sm text-violet-950">
              Pour <strong>cadrer</strong> la mission avec un agent, valider le périmètre, <em>puis</em> lancer
              l’exécution : passe par <strong>Mission guidée</strong>.
            </p>
            <Link
              to={`/mission/guided?agent=${encodeURIComponent(selectedAgent)}`}
              className="shrink-0 text-center text-sm font-medium bg-violet-900 text-white px-4 py-2 rounded-lg hover:bg-violet-800 transition-colors"
            >
              Ouvrir Mission guidée →
            </Link>
          </div>

          {agents.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Choisir un agent</p>
              <AgentGrid
                agents={agents}
                selected={selectedAgent}
                onSelect={setSelectedAgent}
                activityByAgent={agentWorkload?.activityByAgent}
                tokensSnapshot={agentWorkload?.tokensSnapshot}
              />
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Lancement direct (sans cadrage guidé)
            </p>
            <p className="text-xs text-slate-500 mb-4">
              Options ci-dessous : boucles d’affinage CIO après l’équipe, et validation finale par toi (désactivable pour
              enchaîner des missions automatisées).
            </p>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
              Nouvelle mission
              {currentAgent && (
                <span className="ml-2 normal-case font-medium text-slate-600 tracking-normal">→ {currentAgent.label}</span>
              )}
              {currentAgent?.is_manager && (
                <span className="ml-2 text-amber-600 normal-case font-medium tracking-normal">
                  · orchestration multi-agents
                </span>
              )}
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3 space-y-3 text-sm">
                <label className="flex items-start gap-2 cursor-pointer text-slate-800">
                  <input
                    type="checkbox"
                    checked={mcRecursive}
                    onChange={(e) => setMcRecursive(e.target.checked)}
                    disabled={sending}
                    className="mt-1 rounded border-slate-300"
                  />
                  <span>
                    <strong>Boucles d’affinage</strong> : après la première synthèse, jusqu’à <em>N</em> tours où le CIO
                    critique puis peut <strong>replanifier et refaire travailler</strong> les rôles nécessaires (commercial,
                    dev, etc.) avant une nouvelle synthèse — pas seulement une réécriture sans équipe.
                  </span>
                </label>
                {mcRecursive ? (
                  <div className="pl-6 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>Nombre max de tours (1–5) :</span>
                    <input
                      type="number"
                      min={1}
                      max={5}
                      value={mcRounds}
                      onChange={(e) => setMcRounds(e.target.value)}
                      disabled={sending}
                      className="w-16 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                    />
                  </div>
                ) : null}
                <label className="flex items-start gap-2 cursor-pointer text-slate-800">
                  <input
                    type="checkbox"
                    checked={mcRequireValidation}
                    onChange={(e) => setMcRequireValidation(e.target.checked)}
                    disabled={sending}
                    className="mt-1 rounded border-slate-300"
                  />
                  <span>
                    <strong>Exiger ma validation</strong> en fin de mission (case + bouton). Décoche pour auto-clôturer
                    dès que le pipeline est terminé (utile pour enchaîner des missions / automatisations).
                  </span>
                </label>
              </div>
              <textarea
                rows={4}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none outline-none focus:border-slate-400 bg-slate-50 placeholder:text-slate-400"
                placeholder={`Instruis ${currentAgent?.label || "l'agent"} en langage naturel…`}
                value={mission}
                onChange={(e) => setMission(e.target.value)}
                disabled={sending}
              />
              {error && <p className="text-sm text-red-500">{error}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={sending}
                  className="bg-slate-900 text-white text-sm font-medium px-6 py-2.5 rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-40 cursor-pointer"
                >
                  {sending ? "Envoi…" : "Lancer →"}
                </button>
              </div>
            </form>
          </div>
        </>
      )}

      {mode === "tracking" &&
        (missionsOnMainForm.length > 0 ? (
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-1">
              Suivi des missions
              <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 normal-case text-xs ml-1 font-medium">
                {missionsOnMainForm.length}
              </span>
            </p>
            <p className="text-xs text-slate-500 mb-3 leading-relaxed">
              Les missions <strong className="text-slate-700">exécutées</strong> restent ici jusqu’à ta{" "}
              <strong className="text-slate-700">validation explicite</strong> (case + bouton), puis tu peux{" "}
              <strong className="text-slate-700">Archiver</strong>. Tu peux à tout moment{" "}
              <strong className="text-slate-700">poursuivre avec le CIO</strong> depuis le chat tant que tu n’as pas
              validé. L’onglet <strong className="text-slate-600">Historique</strong> garde la liste complète.
            </p>
            <div className="flex flex-col gap-4">
              {missionsOnMainForm.map((j) => (
                <JobCard
                  key={j.job_id}
                  job={j}
                  highlight={highlightJobId === j.job_id}
                  onArchiveFromMain={archiveFromMain}
                  onMissionValidated={markMissionValidated}
                />
              ))}
            </div>
          </div>
        ) : jobs.length > 0 ? (
          <p className="text-sm text-slate-500 border border-slate-100 rounded-xl bg-slate-50/80 px-4 py-3">
            Toutes les missions ont été <strong className="text-slate-700">archivées depuis ce formulaire</strong>. Tu
            peux toujours les consulter dans l’onglet <strong className="text-slate-700">Historique</strong>.
          </p>
        ) : null)}
    </div>
  );
}

/** Indique si des sous-agents ont réellement tourné (pour message utilisateur). */
function cioChatHadSubAgents(events) {
  const ev = Array.isArray(events) ? events : [];
  const del = ev.find((e) => e.type === "delegation");
  const to = del?.payload?.to;
  if (Array.isArray(to) && to.length > 0) return true;
  return extractRoleOutputs(ev).length > 0;
}

/** Suivi temps réel du job CIO (chat) : même donnée que l’onglet Missions, mis à jour par polling. */
function CioChatLivePanel({ jobId, onComplete, onError }) {
  const onCompleteRef = useRef(onComplete);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onCompleteRef.current = onComplete;
    onErrorRef.current = onError;
  });

  const [job, setJob] = useState({
    job_id: jobId,
    status: "running",
    agent: "coordinateur",
    mission: "",
    result: null,
    team: [],
    plan: {},
    events: [],
    delivery_warnings: [],
    mission_thread: [],
    mission_thread_count: 0,
    tokens_in: 0,
    tokens_out: 0,
    tokens_total: 0,
    cost_usd: 0,
    token_alert: false,
    source: "chat",
  });
  const [logs, setLogs] = useState([]);
  const [cioTechOpen, setCioTechOpen] = useState(false);
  const [cioJournalOpen, setCioJournalOpen] = useState(false);
  const [cioProcessOpen, setCioProcessOpen] = useState(false);
  const logOffsetRef = useRef(0);
  const doneRef = useRef(false);
  const emptyCompletePollsRef = useRef(0);
  const cioLogsScrollRef = useRef(null);

  const lineColor = (l) =>
    l.startsWith("[korymb] Mission démarrée")
      ? "text-sky-400"
      : l.includes("terminée") || l.startsWith("✓")
        ? "text-emerald-400"
        : l.startsWith("[korymb] Erreur") || l.includes("⚠️")
          ? "text-red-400"
          : l.includes("tokens")
            ? "text-violet-400"
            : l.includes("[CIO →") || l.includes("→ CIO]")
              ? "text-cyan-300"
              : "text-slate-300";

  useEffect(() => {
    let cancelled = false;
    const ac = new AbortController();
    const tick = async () => {
      if (cancelled || doneRef.current) return;
      try {
        const res = await fetch(
          `${API}/jobs/${jobId}?log_offset=${logOffsetRef.current}&events_offset=0`,
          { headers: authHeaders(), signal: ac.signal },
        );
        if (!res.ok) {
          if (!cancelled && !doneRef.current) setTimeout(tick, 1600);
          return;
        }
        const d = await res.json();
        if (cancelled || doneRef.current) return;
        if (typeof d.log_total === "number") {
          if (Array.isArray(d.logs) && d.logs.length > 0) {
            setLogs((p) => [...p, ...d.logs]);
          }
          logOffsetRef.current = d.log_total;
        }
        setJob((j) => ({
          ...j,
          status: d.status,
          mission: d.mission || j.mission,
          result: d.result != null ? d.result : j.result,
          team: Array.isArray(d.team) ? d.team : j.team,
          plan: d.plan != null ? d.plan : j.plan,
          events: Array.isArray(d.events) ? d.events : j.events,
          delivery_warnings: Array.isArray(d.delivery_warnings) ? d.delivery_warnings : j.delivery_warnings,
          mission_thread: Array.isArray(d.mission_thread) ? d.mission_thread : j.mission_thread,
          mission_thread_count:
            typeof d.mission_thread_count === "number" ? d.mission_thread_count : j.mission_thread_count,
          tokens_in: d.tokens_in ?? j.tokens_in,
          tokens_out: d.tokens_out ?? j.tokens_out,
          tokens_total: d.tokens_total ?? j.tokens_total,
          cost_usd: d.cost_usd ?? j.cost_usd,
          token_alert: d.token_alert ?? j.token_alert,
          source: d.source || j.source,
        }));
        const terminal =
          d.status === "completed" || String(d.status || "").startsWith("error");
        if (d.status === "completed" && !doneRef.current) {
          const resultStr = d.result != null ? String(d.result) : "";
          if (!resultStr.trim() && emptyCompletePollsRef.current < 20) {
            emptyCompletePollsRef.current += 1;
            if (!cancelled && !doneRef.current) setTimeout(tick, 450);
            return;
          }
          doneRef.current = true;
          emptyCompletePollsRef.current = 0;
          if (!cancelled) {
            onCompleteRef.current({
              result: resultStr,
              plan: d.plan || {},
              events: d.events || [],
              team: d.team || [],
              trace_job_id: jobId,
              mission_thread: Array.isArray(d.mission_thread) ? d.mission_thread : [],
              mission_thread_count:
                typeof d.mission_thread_count === "number" ? d.mission_thread_count : 0,
              delivery_warnings: Array.isArray(d.delivery_warnings) ? d.delivery_warnings : [],
            });
          }
        } else if (String(d.status || "").startsWith("error") && !doneRef.current) {
          doneRef.current = true;
          if (!cancelled) onErrorRef.current(d.status);
        }
        if (!terminal && !cancelled && !doneRef.current) setTimeout(tick, 1300);
      } catch (e) {
        if (e?.name === "AbortError") return;
        if (!cancelled && !doneRef.current) setTimeout(tick, 2000);
      }
    };
    tick();
    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [jobId]);

  useEffect(() => {
    setCioJournalOpen(false);
    setCioProcessOpen(false);
    setCioTechOpen(false);
  }, [jobId]);

  useEffect(() => {
    const el = cioLogsScrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [logs]);

  const isRunning = job.status === "running";
  const isError = String(job.status || "").startsWith("error");
  const statusCls = isRunning
    ? "bg-amber-100 text-amber-700"
    : isError
      ? "bg-red-100 text-red-700"
      : "bg-emerald-100 text-emerald-700";
  const statusLabel = isRunning ? "En cours" : isError ? "Erreur" : "Terminé";
  const liveDeliveryWarnings = useMemo(() => extractDeliveryWarnings(job), [job.events, job.delivery_warnings]);

  return (
    <div className="rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50/60 to-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-violet-800">
            CIO · suivi en direct
          </p>
          <p className="text-[11px] text-slate-500 mt-0.5 font-mono">#{jobId}</p>
        </div>
        <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusCls}`}>{statusLabel}</span>
      </div>
      <p className="text-[11px] text-slate-500 mb-3 leading-snug">
        Le fil de discussion reste au-dessus : ouvre les sections seulement si tu veux le{" "}
        <strong className="text-slate-700">journal</strong>, l&apos;<strong className="text-slate-700">enchaînement</strong>{" "}
        ou les <strong className="text-slate-700">détails techniques</strong> (logs, observabilité).
      </p>
      <DeliveryWarningsBanner warnings={liveDeliveryWarnings} className="mb-2" />
      <MissionProcessPreview team={job.team} events={job.events} plan={job.plan} />
      <CollapsibleBand
        className="mt-1"
        bandId={`chat-live-${jobId}-journal`}
        title="Journal de mission"
        subtitle="Ta consigne, l’échange visible avec le CIO et le fil lié à ce run (comme sur la carte mission)."
        open={cioJournalOpen}
        onToggle={() => setCioJournalOpen((v) => !v)}
        bodyClassName="px-4 pb-4 border-t border-slate-100 bg-white/90 space-y-3 pt-3"
      >
        {job.mission ? (
          <div className="rounded-xl border border-emerald-200/90 bg-emerald-50/50 px-3 py-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-900 mb-1">Consigne / mission</p>
            <p className="text-xs text-slate-900 leading-relaxed whitespace-pre-wrap">{job.mission}</p>
          </div>
        ) : null}
        <MissionThreadView
          thread={job.mission_thread}
          count={job.mission_thread_count}
          events={job.events}
          plan={job.plan}
          threadMode="lead_focus"
          focusAgent="coordinateur"
        />
      </CollapsibleBand>
      <CollapsibleBand
        className="mt-2"
        bandId={`chat-live-${jobId}-process`}
        title="Enchaînement du processus"
        subtitle="Équipe, relais entre rôles et graphe d’interactions — pour suivre le travail en coulisse."
        open={cioProcessOpen}
        onToggle={() => setCioProcessOpen((v) => !v)}
        bodyClassName="px-4 pb-4 border-t border-slate-100 space-y-3 pt-3 bg-slate-50/50"
      >
        <TeamTrack team={job.team} />
        <InteractionFlow events={job.events} plan={job.plan} />
      </CollapsibleBand>
      <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/90 overflow-hidden">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setCioTechOpen((o) => !o);
          }}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-100/80 cursor-pointer transition-colors"
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-800">Détails techniques</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-snug">
              Observabilité et logs moteur (le panneau reste actif en arrière-plan pendant le run).
            </p>
          </div>
          <span className="text-slate-400 text-sm shrink-0" aria-hidden>
            {cioTechOpen ? "▼" : "▶"}
          </span>
        </button>
        <div className={cioTechOpen ? "border-t border-slate-200" : "sr-only"}>
          <div className="px-4 py-3 space-y-3">
            {(job.tokens_total > 0 || Number(job.cost_usd) > 0) && (
              <p className="text-xs text-slate-600">
                <span className="font-semibold text-slate-700">Métriques :</span>{" "}
                <span className="font-mono">{job.tokens_total?.toLocaleString() || 0} tok</span>
                {job.cost_usd != null && (
                  <>
                    {" "}
                    · <span className="font-mono">${job.cost_usd}</span>
                  </>
                )}
              </p>
            )}
            <ObservabilityPanel plan={job.plan} events={job.events} defaultOpen={false} compact />
            <div className="rounded-xl bg-[#0d1117] overflow-hidden border border-slate-800">
              <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-800">
                <span className="w-3 h-3 rounded-full bg-red-500/70" />
                <span className="w-3 h-3 rounded-full bg-amber-400/70" />
                <span className="w-3 h-3 rounded-full bg-emerald-500/70" />
                <span className="ml-2 text-xs text-slate-500 font-mono">logs</span>
                {isRunning && <span className="ml-auto text-xs text-amber-400 animate-pulse">live</span>}
              </div>
              <div
                ref={cioLogsScrollRef}
                className="p-4 max-h-56 overflow-y-auto overflow-x-hidden font-mono text-xs leading-relaxed min-h-0"
              >
                {logs.length === 0 ? (
                  <span className="text-slate-600">En attente de sortie…</span>
                ) : (
                  logs.map((l, i) => (
                    <div key={i} className={lineColor(l)}>
                      {l}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Onglet Chat ──────────────────────────────────────────────────────────────

function ChatTab({ agents, seedFollowJobId, onConsumeSeedFollowJob, agentWorkload }) {
  const initBlob = useMemo(() => readChatPersistBlob(), []);
  const initRoomId = initBlob.activeRoomId;
  const initRoom = initBlob.rooms[initRoomId] || {};
  const rawInitAgent = isValidChatAgentKey(initRoom.selectedAgent) ? initRoom.selectedAgent : "coordinateur";
  const initSession = (initRoom.sessions && initRoom.sessions[rawInitAgent]) || {};

  const [activeRoomId, setActiveRoomId] = useState(initRoomId);
  const [roomsTick, setRoomsTick] = useState(0);
  const [selectedAgent, setSelectedAgent] = useState(rawInitAgent);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState(() => clampChatHistory(initSession.history || []));
  const [loading, setLoading] = useState(false);
  const [lastTrace, setLastTrace] = useState(() => initSession.lastTrace || null);
  const [linkedJobId, setLinkedJobId] = useState(() => initSession.linkedJobId || null);
  const [cioLiveJobId, setCioLiveJobId] = useState(null);
  const [chatTraceJournalOpen, setChatTraceJournalOpen] = useState(false);
  const [chatTraceProcessOpen, setChatTraceProcessOpen] = useState(false);
  const [renameRoomId, setRenameRoomId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const messagesScrollRef = useRef(null);

  const cancelRenameRoom = useCallback(() => {
    setRenameRoomId(null);
    setRenameDraft("");
  }, []);

  const commitRenameRoom = useCallback(() => {
    if (!renameRoomId) return;
    let t = renameDraft.trim() || "Conversation";
    if (t.length > CHAT_ROOM_TITLE_MAX) t = t.slice(0, CHAT_ROOM_TITLE_MAX);
    const prev = readChatPersistBlob();
    const cur = prev.rooms[renameRoomId];
    if (!cur) {
      cancelRenameRoom();
      return;
    }
    writeChatPersistBlob({
      ...prev,
      rooms: {
        ...prev.rooms,
        [renameRoomId]: {
          ...cur,
          title: t,
          updatedAt: Date.now(),
        },
      },
    });
    setRoomsTick((v) => v + 1);
    cancelRenameRoom();
  }, [renameRoomId, renameDraft, cancelRenameRoom]);

  const flushCurrentRoomToStorage = useCallback(() => {
    const prev = readChatPersistBlob();
    const cur = prev.rooms[activeRoomId];
    const base =
      cur && typeof cur === "object"
        ? cur
        : {
            title: "Conversation",
            createdAt: Date.now(),
            selectedAgent: "coordinateur",
            sessions: {},
          };
    writeChatPersistBlob({
      ...prev,
      activeRoomId,
      rooms: {
        ...prev.rooms,
        [activeRoomId]: {
          ...base,
          updatedAt: Date.now(),
          selectedAgent,
          sessions: {
            ...(base.sessions || {}),
            [selectedAgent]: {
              history: clampChatHistory(history),
              lastTrace,
              linkedJobId: linkedJobId || null,
            },
          },
        },
      },
    });
  }, [activeRoomId, selectedAgent, history, lastTrace, linkedJobId]);

  const switchChatRoom = useCallback(
    (nextId) => {
      if (nextId === activeRoomId || loading || cioLiveJobId) return;
      flushCurrentRoomToStorage();
      const prev = readChatPersistBlob();
      const nextRoom = prev.rooms[nextId];
      if (!nextRoom) return;
      const agent = isValidChatAgentKey(nextRoom.selectedAgent) ? nextRoom.selectedAgent : "coordinateur";
      const snap = nextRoom.sessions?.[agent] || {};
      writeChatPersistBlob({ ...prev, activeRoomId: nextId });
      setActiveRoomId(nextId);
      setSelectedAgent(agent);
      setHistory(clampChatHistory(snap.history || []));
      setLastTrace(snap.lastTrace || null);
      setLinkedJobId(snap.linkedJobId || null);
      setCioLiveJobId(null);
      setRoomsTick((v) => v + 1);
    },
    [activeRoomId, loading, cioLiveJobId, flushCurrentRoomToStorage],
  );

  const createNewChatRoom = useCallback(() => {
    if (loading || cioLiveJobId) return;
    flushCurrentRoomToStorage();
    const prev = readChatPersistBlob();
    const id = newChatRoomId();
    const n = Object.keys(prev.rooms).length + 1;
    writeChatPersistBlob({
      ...prev,
      activeRoomId: id,
      rooms: {
        ...prev.rooms,
        [id]: {
          title: `Conversation ${n}`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          selectedAgent: "coordinateur",
          sessions: {},
        },
      },
    });
    setActiveRoomId(id);
    setSelectedAgent("coordinateur");
    setHistory([]);
    setLastTrace(null);
    setLinkedJobId(null);
    setCioLiveJobId(null);
    setRoomsTick((v) => v + 1);
  }, [loading, cioLiveJobId, flushCurrentRoomToStorage]);

  const deleteChatRoom = useCallback(
    (roomIdToDelete) => {
      if (!roomIdToDelete) return;
      if (
        roomIdToDelete === activeRoomId &&
        (loading || cioLiveJobId)
      ) {
        window.alert(
          "Impossible de supprimer cette conversation tant qu’un message est en cours ou qu’une orchestration CIO tourne.",
        );
        return;
      }
      if (
        !window.confirm(
          "Supprimer cette conversation du navigateur ? (Les missions déjà enregistrées sur le serveur ne sont pas effacées.)",
        )
      ) {
        return;
      }
      flushCurrentRoomToStorage();
      const prev = readChatPersistBlob();
      const { [roomIdToDelete]: _removed, ...restRooms } = prev.rooms;
      let nextRooms = restRooms;
      let nextActive = prev.activeRoomId;
      if (renameRoomId === roomIdToDelete) {
        cancelRenameRoom();
      }
      if (roomIdToDelete === prev.activeRoomId) {
        const ids = Object.keys(nextRooms);
        if (ids.length === 0) {
          const nid = newChatRoomId();
          nextRooms = {
            [nid]: {
              title: "Conversation",
              createdAt: Date.now(),
              updatedAt: Date.now(),
              selectedAgent: "coordinateur",
              sessions: {},
            },
          };
          nextActive = nid;
        } else {
          nextActive = [...ids].sort(
            (a, b) => (nextRooms[b].updatedAt || 0) - (nextRooms[a].updatedAt || 0),
          )[0];
        }
      }
      writeChatPersistBlob({ activeRoomId: nextActive, rooms: nextRooms });
      if (roomIdToDelete === activeRoomId) {
        const nr = nextRooms[nextActive];
        const agent = isValidChatAgentKey(nr?.selectedAgent) ? nr.selectedAgent : "coordinateur";
        const snap = nr?.sessions?.[agent] || {};
        setActiveRoomId(nextActive);
        setSelectedAgent(agent);
        setHistory(clampChatHistory(snap.history || []));
        setLastTrace(snap.lastTrace || null);
        setLinkedJobId(snap.linkedJobId || null);
        setCioLiveJobId(null);
      }
      setRoomsTick((v) => v + 1);
    },
    [
      activeRoomId,
      loading,
      cioLiveJobId,
      flushCurrentRoomToStorage,
      renameRoomId,
      cancelRenameRoom,
    ],
  );

  const roomListSorted = useMemo(() => {
    const b = readChatPersistBlob();
    return Object.entries(b.rooms).sort(([, ra], [, rb]) => (rb.updatedAt || 0) - (ra.updatedAt || 0));
  }, [roomsTick, activeRoomId]);

  useEffect(() => {
    if (!seedFollowJobId) return undefined;
    setLinkedJobId(seedFollowJobId);
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API}/jobs/${encodeURIComponent(seedFollowJobId)}`, {
          headers: authHeaders(),
        });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (cancelled) return;
        setSelectedAgent("coordinateur");
        const m = (d.mission || "").replace(/\*/g, "").trim();
        const pilot = String(d.agent || "").trim() || "coordinateur";
        const pilotNote = pilot !== "coordinateur" ? ` · pilote *${pilot}*` : "";
        const resultText = typeof d.result === "string" ? d.result.trim() : "";
        if (resultText) {
          setHistory([
            {
              role: "assistant",
              content:
                `*(Poursuite après la mission **#${seedFollowJobId}**${m ? ` — ${m}` : ""}${pilotNote})*\n\n---\n\n` +
                d.result,
              agent: "coordinateur",
            },
          ]);
        } else {
          setHistory([
            {
              role: "assistant",
              content:
                `*(Reprise de la mission **#${seedFollowJobId}**${m ? ` — ${m}` : ""}${pilotNote}.)*\n\n` +
                `Il n’y a pas encore de synthèse enregistrée pour cette entrée. Tu peux poursuivre la discussion avec le CIO ci-dessous.`,
              agent: "coordinateur",
            },
          ]);
        }
        setLastTrace({
          trace_job_id: seedFollowJobId,
          plan: d.plan || {},
          events: d.events || [],
          team: d.team || [],
          mission_thread: d.mission_thread || [],
          mission_thread_count: d.mission_thread_count ?? 0,
          delivery_warnings: Array.isArray(d.delivery_warnings) ? d.delivery_warnings : [],
        });
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) onConsumeSeedFollowJob?.();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seedFollowJobId, onConsumeSeedFollowJob]);

  useEffect(() => {
    const el = messagesScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    });
  }, [history, cioLiveJobId, loading]);

  useEffect(() => {
    const t = setTimeout(() => {
      flushCurrentRoomToStorage();
    }, 280);
    return () => clearTimeout(t);
  }, [activeRoomId, selectedAgent, history, lastTrace, linkedJobId, flushCurrentRoomToStorage]);

  useEffect(() => {
    setChatTraceJournalOpen(false);
    setChatTraceProcessOpen(false);
  }, [lastTrace?.trace_job_id]);

  useEffect(() => {
    if (!agents?.length) return;
    if (agents.some((ag) => ag.key === selectedAgent)) return;
    const fallback = agents[0].key;
    const blob = readChatPersistBlob();
    const room = blob.rooms[activeRoomId];
    const snap = room?.sessions?.[fallback] || { history: [], lastTrace: null, linkedJobId: null };
    setSelectedAgent(fallback);
    setHistory(clampChatHistory(snap.history || []));
    setLastTrace(snap.lastTrace || null);
    setLinkedJobId(snap.linkedJobId || null);
    setCioLiveJobId(null);
  }, [agents, selectedAgent, activeRoomId]);

  const send = async (e) => {
    e.preventDefault();
    if (!input.trim() || loading || cioLiveJobId) return;
    const msg = input.trim();
    setInput("");
    const newHistory = [...history, { role: "user", content: msg }];
    setHistory(newHistory);
    setLoading(true);
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          message: msg,
          agent: selectedAgent,
          history,
          ...(linkedJobId ? { linked_job_id: linkedJobId } : {}),
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const d = j.detail;
        const detail =
          typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg || x).join(" ") : "";
        throw new Error(detail || `Erreur ${res.status}`);
      }
      const data = await res.json();
      if (selectedAgent === "coordinateur" && data.status === "accepted" && data.job_id) {
        setCioLiveJobId(data.job_id);
        setLoading(false);
        return;
      }
      setHistory((p) => [...p, { role: "assistant", content: data.response, agent: selectedAgent }]);
      if (selectedAgent === "coordinateur" && data.observability) {
        setLastTrace({
          trace_job_id: data.trace_job_id,
          plan: data.observability.plan || {},
          events: data.observability.events || [],
          team: data.observability.team || [],
          mission_thread: data.observability.mission_thread || [],
          mission_thread_count: data.observability.mission_thread_count ?? 0,
          delivery_warnings: Array.isArray(data.delivery_warnings) ? data.delivery_warnings : [],
        });
      } else {
        setLastTrace(null);
      }
    } catch (err) {
      setHistory((p) => [
        ...p,
        { role: "assistant", content: `Erreur : ${err.message}`, agent: selectedAgent },
      ]);
    }
    setLoading(false);
  };

  const currentAgent = agents.find(a => a.key === selectedAgent);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span>Besoin de valider un processus avant exécution ?</span>
        <Link
          to={`/mission/guided?agent=${encodeURIComponent(selectedAgent)}`}
          className="font-medium text-violet-800 hover:text-violet-950 underline-offset-2 hover:underline"
        >
          Mission guidée →
        </Link>
      </div>
      <div>
        <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 shrink-0">Conversations</p>
            <button
              type="button"
              onClick={createNewChatRoom}
              disabled={loading || !!cioLiveJobId}
              className="text-xs font-medium rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-slate-800 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
            >
              + Nouvelle conversation
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {roomListSorted.map(([id, room]) => (
              <div
                key={id}
                className={`flex max-w-[14rem] items-stretch rounded-lg border text-xs font-medium transition-colors ${
                  id === activeRoomId
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-200 bg-white text-slate-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => switchChatRoom(id)}
                  disabled={loading || !!cioLiveJobId}
                  title={room.title || "Conversation"}
                  className={`min-w-0 flex-1 truncate rounded-l-md px-2 py-1 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer ${
                    id === activeRoomId ? "hover:bg-white/10" : "hover:bg-slate-50"
                  }`}
                >
                  {room.title || "Conversation"}
                </button>
                <button
                  type="button"
                  aria-label={`Renommer « ${(room.title || "Conversation").replace(/"/g, "'")} »`}
                  title="Renommer"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setRenameRoomId(id);
                    setRenameDraft(room.title || "");
                  }}
                  className={`shrink-0 border-l px-1.5 py-1 leading-none transition-colors cursor-pointer ${
                    id === activeRoomId
                      ? "border-white/20 text-white/75 hover:bg-white/10 hover:text-white"
                      : "border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-800"
                  }`}
                >
                  ✎
                </button>
                <button
                  type="button"
                  aria-label={`Supprimer « ${(room.title || "Conversation").replace(/"/g, "'")} »`}
                  title="Supprimer la conversation"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteChatRoom(id);
                  }}
                  className={`shrink-0 rounded-r-md border-l px-1.5 py-1 text-[13px] leading-none font-light transition-colors cursor-pointer ${
                    id === activeRoomId
                      ? "border-white/20 text-rose-200/90 hover:bg-rose-950/35 hover:text-rose-50"
                      : "border-slate-200 text-rose-500 hover:bg-rose-50 hover:text-rose-800"
                  }`}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {renameRoomId ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-[11px] text-slate-600 sm:min-w-[14rem]">
                <span className="font-medium text-slate-700">Nom de la conversation</span>
                <input
                  type="text"
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRenameRoom();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRenameRoom();
                    }
                  }}
                  maxLength={CHAT_ROOM_TITLE_MAX}
                  autoFocus
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-500"
                />
              </label>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  onClick={commitRenameRoom}
                  className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 cursor-pointer"
                >
                  Enregistrer
                </button>
                <button
                  type="button"
                  onClick={cancelRenameRoom}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Annuler
                </button>
              </div>
              <p className="w-full text-[10px] text-slate-500">
                Jusqu’à {CHAT_ROOM_TITLE_MAX} caractères · Entrée pour valider, Échap pour fermer.
              </p>
            </div>
          ) : null}
          <p className="text-[10px] text-slate-500 mt-2 leading-snug">
            Chaque conversation garde son propre fil et ses agents (stockage navigateur). Une nouvelle conversation
            démarre vide. Utilise ✎ pour renommer.
          </p>
        </div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Parler à</p>
        <AgentGrid
          agents={agents}
          selected={selectedAgent}
          onSelect={(a) => {
            if (a === selectedAgent) return;
            const prevBlob = readChatPersistBlob();
            const cur = prevBlob.rooms[activeRoomId] || {
              title: "Conversation",
              createdAt: Date.now(),
              selectedAgent: "coordinateur",
              sessions: {},
            };
            const sessions = {
              ...(cur.sessions || {}),
              [selectedAgent]: {
                history: clampChatHistory(history),
                lastTrace,
                linkedJobId: linkedJobId || null,
              },
            };
            const nextSess = sessions[a] || { history: [], lastTrace: null, linkedJobId: null };
            writeChatPersistBlob({
              ...prevBlob,
              activeRoomId,
              rooms: {
                ...prevBlob.rooms,
                [activeRoomId]: {
                  ...cur,
                  updatedAt: Date.now(),
                  selectedAgent: a,
                  sessions,
                },
              },
            });
            setSelectedAgent(a);
            setHistory(clampChatHistory(nextSess.history || []));
            setLastTrace(nextSess.lastTrace || null);
            setLinkedJobId(nextSess.linkedJobId || null);
            setCioLiveJobId(null);
            setRoomsTick((v) => v + 1);
          }}
          activityByAgent={agentWorkload?.activityByAgent}
          tokensSnapshot={agentWorkload?.tokensSnapshot}
        />
        <p className="text-[10px] text-slate-400 mt-2 leading-snug">
          Dans cette conversation, chaque agent conserve son propre fil sur cet appareil, même si tu quittes l’onglet
          ou recharges la page.
        </p>
      </div>

      {linkedJobId ? (
        <p className="text-[11px] text-emerald-950 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 leading-relaxed">
          <strong>Contexte mission</strong> · Les échanges de ce chat sont enregistrés sur la mission{" "}
          <span className="font-mono">#{linkedJobId}</span> (fil « lié à la mission » dans le QG).
        </p>
      ) : null}

      {selectedAgent === "coordinateur" && (
        <p className="text-[11px] text-slate-500 leading-relaxed border border-slate-200 bg-slate-50 rounded-lg px-3 py-2">
          Pendant l’orchestration, un encart <strong>suivi en direct</strong> apparaît sous tes messages : par défaut
          seuls le statut et des sections <strong>repliables</strong> (journal, enchaînement, détails techniques) — comme
          sur la carte mission — pour ne pas noyer la conversation. La synthèse du CIO arrive dans{" "}
          <strong>une seule</strong> bulle dans le fil.
        </p>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Messages */}
        <div
          ref={messagesScrollRef}
          className="p-5 min-h-64 max-h-[500px] overflow-y-auto overflow-x-hidden flex flex-col gap-4 overscroll-contain"
        >
          {history.length === 0 && (
            <div className="text-center text-slate-400 text-sm pt-8">
              <span className="text-4xl block mb-3">{ICONS[selectedAgent]||"🤖"}</span>
              Commence une conversation avec {currentAgent?.label}
              {selectedAgent === "coordinateur" && (
                <span className="block text-xs mt-3 max-w-sm mx-auto text-slate-500">
                  Envoie un message : le suivi détaillé s’affiche en direct, puis la synthèse du CIO dans une bulle.
                </span>
              )}
            </div>
          )}
          {history.map((m, i) => (
            <div key={i} className={`flex ${m.role==="user"?"justify-end":"justify-start"}`}>
              {m.role === "assistant" && (
                <span className="text-xl mr-2 mt-1 shrink-0">{ICONS[m.agent]||"🤖"}</span>
              )}
              <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed
                ${m.role==="user"
                  ? "bg-slate-900 text-white rounded-br-sm"
                  : "bg-slate-100 text-slate-800 rounded-bl-sm"}`}>
                {m.role === "assistant" ? <MemoMarkdown content={m.content} /> : m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <span className="text-xl mr-2">{ICONS[selectedAgent] || "🤖"}</span>
              <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3 max-w-[85%]">
                <span className="text-slate-500 text-sm animate-pulse block font-medium">
                  {selectedAgent === "coordinateur" ? "Envoi au CIO…" : "En train de réfléchir…"}
                </span>
                {selectedAgent === "coordinateur" && (
                  <p className="text-xs text-slate-500 mt-2 leading-relaxed">
                    Dès acceptation : encart violet <strong>suivi en direct</strong> (sections repliables : journal,
                    enchaînement, détails techniques).
                  </p>
                )}
              </div>
            </div>
          )}
          {cioLiveJobId ? (
            <CioChatLivePanel
              jobId={cioLiveJobId}
              onComplete={(payload) => {
                setCioLiveJobId(null);
                setHistory((p) => [
                  ...p,
                  { role: "assistant", content: payload.result, agent: "coordinateur" },
                ]);
                setLastTrace({
                  trace_job_id: payload.trace_job_id,
                  plan: payload.plan || {},
                  events: payload.events || [],
                  team: payload.team || [],
                  mission_thread: payload.mission_thread || [],
                  mission_thread_count: payload.mission_thread_count ?? 0,
                  delivery_warnings: Array.isArray(payload.delivery_warnings)
                    ? payload.delivery_warnings
                    : [],
                });
              }}
              onError={(status) => {
                setCioLiveJobId(null);
                setHistory((p) => [
                  ...p,
                  {
                    role: "assistant",
                    content: `Erreur orchestration : ${status}`,
                    agent: "coordinateur",
                  },
                ]);
                setLastTrace(null);
              }}
            />
          ) : null}
        </div>

        {/* Input */}
        <form onSubmit={send} className="border-t border-slate-100 p-4 flex gap-3 shrink-0">
          <input
            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50"
            placeholder={`Message à ${currentAgent?.label || "l'agent"}…`}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading || !!cioLiveJobId}
          />
          <button type="submit" disabled={loading || !!cioLiveJobId || !input.trim()}
            className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-40 cursor-pointer">
            Envoyer
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-400">
        <strong className="text-slate-600">CIO :</strong> orchestration en arrière-plan avec{" "}
        <strong className="text-slate-600">suivi en direct</strong> (repliable) puis{" "}
        <strong className="text-slate-600">une seule bulle</strong> de synthèse dans le fil.{" "}
        <strong className="text-slate-600">Autres agents :</strong> chat synchrone, une réponse à la fois.
      </p>

      {lastTrace && selectedAgent === "coordinateur" && (
        <div className="space-y-2">
          <div className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-950 leading-relaxed">
            <strong>Réponse reçue = fin de ce tour.</strong>{" "}
            {cioChatHadSubAgents(lastTrace.events)
              ? "Les autres rôles ont déjà travaillé en coulisse ; le texte du CIO est la synthèse. Ouvre le journal ou l’enchaînement ci-dessous pour le détail."
              : "Sur ce tour, le CIO n’a délégué à personne : il n’y a donc pas d’autres « réponses » à attendre. Reformule en demandant explicitement le commercial / un autre rôle si besoin."}
          </div>
          <DeliveryWarningsBanner warnings={extractDeliveryWarnings(lastTrace)} />
          <MissionProcessPreview team={lastTrace.team} events={lastTrace.events} plan={lastTrace.plan} />
          <CollapsibleBand
            className="mt-1"
            bandId={`chat-trace-${lastTrace.trace_job_id || "x"}-journal`}
            title="Journal de mission"
            subtitle="Échange avec le CIO et fil lié à ce tour (repliable)."
            open={chatTraceJournalOpen}
            onToggle={() => setChatTraceJournalOpen((v) => !v)}
            bodyClassName="px-4 pb-4 border-t border-slate-100 bg-slate-50/50 pt-3"
          >
            <MissionThreadView
              thread={lastTrace.mission_thread}
              count={lastTrace.mission_thread_count}
              events={lastTrace.events}
              plan={lastTrace.plan}
              threadMode="lead_focus"
              focusAgent="coordinateur"
            />
          </CollapsibleBand>
          <CollapsibleBand
            className="mt-2"
            bandId={`chat-trace-${lastTrace.trace_job_id || "x"}-process`}
            title="Enchaînement, équipe & observabilité"
            subtitle="Flux, livrables, observabilité — l’aperçu des rôles est au-dessus du journal."
            open={chatTraceProcessOpen}
            onToggle={() => setChatTraceProcessOpen((v) => !v)}
            bodyClassName="px-4 pb-4 border-t border-slate-100 space-y-3 pt-3 bg-white/90"
          >
            <TeamTrack team={lastTrace.team} />
            <InteractionFlow events={lastTrace.events} plan={lastTrace.plan} />
            <ObservabilityPanel plan={lastTrace.plan} events={lastTrace.events} defaultOpen={false} />
          </CollapsibleBand>
          {lastTrace.trace_job_id ? (
            <p className="text-xs text-slate-500">
              Trace enregistrée ·{" "}
              <span className="font-mono text-slate-700">#{lastTrace.trace_job_id}</span>{" "}
              (onglet Historique, source chat)
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Onglet Historique ────────────────────────────────────────────────────────
function HistoryTab({ onResumeWithCio }) {
  const [historyUrlParams, setHistoryUrlParams] = useSearchParams();
  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail]     = useState(null);
  const [actionError, setActionError] = useState("");
  const [hvChecked, setHvChecked] = useState(false);
  const [hvBusy, setHvBusy] = useState(false);
  const [hvErr, setHvErr] = useState("");
  const [historyTechOpen, setHistoryTechOpen] = useState(false);
  const [histConsigneOpen, setHistConsigneOpen] = useState(false);
  const [histProcessOpen, setHistProcessOpen] = useState(false);

  const historyJobFromUrl = (historyUrlParams.get("historyJob") || "").trim();
  useEffect(() => {
    if (!historyJobFromUrl) return;
    setSelected(historyJobFromUrl);
    setDetail(null);
    const u = new URLSearchParams(historyUrlParams);
    u.delete("historyJob");
    setHistoryUrlParams(u, { replace: true });
  }, [historyJobFromUrl, historyUrlParams, setHistoryUrlParams]);

  const loadJobs = () => {
    setLoading(true);
    setActionError("");
    fetch(`${API}/jobs`, { headers: authHeaders() })
      .then(r => {
        if (!r.ok) throw new Error(`Erreur ${r.status}`);
        return r.json();
      })
      .then(d => { setJobs(d.jobs||[]); setLoading(false); })
      .catch((err) => { setLoading(false); setActionError(networkErrorMessage(err)); });
  };

  useEffect(() => { loadJobs(); }, []);

  const deleteJob = async (jobId, e) => {
    e.preventDefault();
    e.stopPropagation();
    setActionError("");
    try {
      const res = await removeJobFromApi(jobId);
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        const hint =
          apiNotFoundHint(res.status, raw.detail) ||
          apiMethodNotAllowedHint(res.status, raw.detail);
        const msg = hint || raw.detail || `Erreur ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      if (selected === jobId) { setSelected(null); setDetail(null); }
      setJobs(p => p.filter(j => j.job_id !== jobId));
    } catch (err) {
      setActionError(networkErrorMessage(err) || "Suppression impossible.");
    }
  };

  const clearAll = async () => {
    if (!window.confirm("Effacer tout l'historique ?")) return;
    setActionError("");
    try {
      const res = await clearAllJobsApi();
      if (!res.ok) {
        const raw = await res.json().catch(() => ({}));
        const hint =
          apiNotFoundHint(res.status, raw.detail) ||
          apiMethodNotAllowedHint(res.status, raw.detail);
        const msg = hint || raw.detail || `Erreur ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      }
      setJobs([]); setSelected(null); setDetail(null);
    } catch (err) {
      setActionError(networkErrorMessage(err) || "Effacement impossible.");
    }
  };

  useEffect(() => {
    if (!selected) return;
    fetch(`${API}/jobs/${selected}`, { headers: authHeaders() })
      .then(r => r.json()).then(setDetail).catch(()=>{});
  }, [selected]);

  useEffect(() => {
    setHvChecked(false);
    setHvErr("");
    setHistoryTechOpen(false);
    setHistConsigneOpen(false);
    setHistProcessOpen(false);
  }, [selected]);

  const rowStatusCls = (j) => {
    const st = j.status;
    const src = j.source || "mission";
    const closed = j.mission_closed_by_user || j.user_validated_at;
    const mc = j.mission_config || {};
    const reqVal = mc.require_user_validation !== false;
    if (st === "running") return "bg-amber-100 text-amber-700";
    if (String(st || "").startsWith("error")) return "bg-red-100 text-red-700";
    if (st === "completed" && src === "mission" && !closed && reqVal) return "bg-sky-100 text-sky-900";
    if (st === "completed") return "bg-emerald-100 text-emerald-700";
    return "bg-amber-100 text-amber-700";
  };

  const rowStatusLabel = (j) => {
    const st = j.status;
    const src = j.source || "mission";
    const closed = j.mission_closed_by_user || j.user_validated_at;
    const mc = j.mission_config || {};
    const reqVal = mc.require_user_validation !== false;
    if (st === "running") return "En cours";
    if (String(st || "").startsWith("error")) return "Erreur";
    if (st === "completed" && src === "mission" && !closed && reqVal) return "À valider";
    if (st === "completed" && src === "mission" && closed) return "Clôturée";
    if (st === "completed") return "Terminé";
    return "En cours";
  };

  const linkedChildren = useMemo(() => {
    if (!detail?.job_id) return [];
    return jobs.filter((x) => x.parent_job_id === detail.job_id);
  }, [jobs, detail?.job_id]);

  const validateHistoryMission = async () => {
    if (!detail?.job_id || !hvChecked || hvBusy) return;
    setHvBusy(true);
    setHvErr("");
    try {
      const res = await validateMissionApi(detail.job_id);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(missionValidateFailureMessage(res, data));
      }
      const r2 = await fetch(`${API}/jobs/${encodeURIComponent(detail.job_id)}`, { headers: authHeaders() });
      if (r2.ok) setDetail(await r2.json());
      loadJobs();
    } catch (e) {
      setHvErr(e.message || "Validation impossible.");
    } finally {
      setHvBusy(false);
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Chargement…</p>;

  return (
    <div className="flex gap-4">
      <div className="w-72 shrink-0 flex flex-col gap-2">
        {actionError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">{actionError}</p>
        )}
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs text-slate-400">{jobs.length} mission{jobs.length!==1?"s":""}</span>
          {jobs.length > 0 && (
            <button type="button" onClick={clearAll}
              className="text-xs text-red-600 hover:text-red-700 cursor-pointer border border-red-200 rounded-lg px-2 py-1 bg-white">
              Tout effacer
            </button>
          )}
        </div>
        {!jobs.length && <p className="text-sm text-slate-400">Aucune mission enregistrée.</p>}
        <div className="max-h-[560px] overflow-y-auto flex flex-col gap-2 pr-1">
        {jobs.map(j => (
          <div key={j.job_id} className={`relative border rounded-xl px-4 py-3 transition-all cursor-pointer
            ${selected===j.job_id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400"}`}
            onClick={() => { setSelected(j.job_id); setDetail(null); }}>
            <div className="flex justify-between items-center mb-1">
              <span className={`text-xs ${selected===j.job_id?"text-slate-300":"text-slate-500"}`}>
                {ICONS[j.agent]||"🤖"} {j.agent}
              </span>
              <div className="flex items-center gap-1">
                {j.delivery_blocked ? (
                  <span
                    className="inline-block w-2 h-2 rounded-full bg-red-600 shrink-0"
                    title="Livrable : pas de trace des recherches web attendues"
                    aria-label="Alerte livrable"
                  />
                ) : null}
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                  ${selected===j.job_id ? "bg-slate-700 text-slate-200" : rowStatusCls(j)}`}>
                  {rowStatusLabel(j)}
                </span>
                <button type="button" onClick={e => deleteJob(j.job_id, e)} title="Supprimer cette mission"
                  className={`shrink-0 text-xs px-2 py-0.5 rounded border cursor-pointer transition-colors
                    ${selected===j.job_id
                      ? "border-red-400/50 text-red-200 hover:bg-red-950/40 hover:text-white"
                      : "border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200"}`}>
                  Suppr.
                </button>
              </div>
            </div>
            <p className={`text-xs truncate ${selected===j.job_id?"text-slate-200":"text-slate-600"}`}>{j.mission}</p>
            {j.parent_job_id ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setSelected(j.parent_job_id);
                  setDetail(null);
                }}
                className={`mt-1.5 text-left text-[10px] font-medium underline-offset-2 hover:underline ${
                  selected === j.job_id ? "text-sky-200" : "text-violet-700"
                }`}
              >
                ↑ Liée à la mission #{j.parent_job_id}
              </button>
            ) : null}
            <div className={`flex items-center justify-between mt-1 text-xs ${selected===j.job_id?"text-slate-400":"text-slate-400"}`}>
              {j.created_at && <span>{new Date(j.created_at+"Z").toLocaleString("fr-FR")}</span>}
              <span className="flex items-center gap-1.5">
                {(j.tokens_in||j.tokens_out) ? <span>{(j.tokens_in+j.tokens_out).toLocaleString()} tok</span> : null}
                {j.source === "chat" && (
                  <span className="text-violet-600 font-medium" title={j.parent_job_id ? "Tour CIO lié à une mission" : "Chat CIO"}>
                    {j.parent_job_id ? "chat · suite" : "chat"}
                  </span>
                )}
                {(j.events_count > 0 || j.has_plan) && (
                  <span className="text-indigo-600 font-medium" title="Trace observabilité">
                    ◈ {j.events_count || 0}
                  </span>
                )}
              </span>
            </div>
          </div>
        ))}</div>
      </div>

      <div className="flex-1 min-w-0">
        {!selected && <p className="text-sm text-slate-400 pt-2">Sélectionne une mission.</p>}
        {selected && !detail && <p className="text-sm text-slate-400">Chargement…</p>}
        {detail && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-lg shrink-0">{ICONS[detail.agent] || "🤖"}</span>
                <div className="min-w-0">
                  <span className="font-semibold text-slate-800">{detail.agent}</span>
                  <span className="font-mono text-xs text-slate-400 ml-2">#{detail.job_id}</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 w-full sm:w-auto sm:text-right leading-snug">
                <strong className="text-slate-700">Synthèse</strong>, puis <strong className="text-slate-700">aperçu d’enchaînement</strong>{" "}
                (qui a travaillé), puis <strong className="text-slate-700">journal</strong>. Consigne, détail flux / équipe
                et métriques : <strong className="text-slate-700">bandeaux repliables</strong>.
              </p>
            </div>

            <DeliveryWarningsBanner warnings={extractDeliveryWarnings(detail)} className="mb-3" />

            {detail.parent_job_id ? (
              <div className="mb-3 rounded-lg border border-violet-200 bg-violet-50/90 px-3 py-2.5 text-xs text-violet-950 leading-relaxed">
                <strong className="text-violet-900">Poursuite CIO</strong> rattachée à la mission d’origine{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSelected(detail.parent_job_id);
                    setDetail(null);
                  }}
                  className="font-mono text-violet-800 underline hover:text-violet-950 cursor-pointer"
                >
                  #{detail.parent_job_id}
                </button>
                . Chaque tour d’orchestration crée une ligne d’historique ; les échanges correspondants sont aussi
                fusionnés dans le <strong>journal</strong> de la mission d’origine.
              </div>
            ) : null}

            {linkedChildren.length > 0 ? (
              <div className="mb-3 rounded-lg border border-sky-200 bg-sky-50/90 px-3 py-2.5 text-xs text-sky-950 leading-relaxed">
                <p className="font-semibold text-sky-900 mb-1.5">Suivis CIO depuis cette mission</p>
                <ul className="flex flex-wrap gap-2">
                  {linkedChildren.map((c) => (
                    <li key={c.job_id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSelected(c.job_id);
                          setDetail(null);
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-sky-300/80 bg-white px-2.5 py-1 font-mono text-[11px] text-sky-900 hover:bg-sky-100 cursor-pointer"
                      >
                        #{c.job_id}
                        <span className="text-sky-600 font-sans text-[10px]">
                          {c.status === "completed" ? "terminé" : String(c.status || "").slice(0, 12)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {typeof onResumeWithCio === "function" ? (
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <button
                  type="button"
                  onClick={() => onResumeWithCio(detail.parent_job_id || detail.job_id)}
                  className="inline-flex items-center text-sm font-medium bg-violet-900 text-white px-4 py-2 rounded-lg hover:bg-violet-800 cursor-pointer transition-colors"
                >
                  Reprendre avec le CIO
                </button>
                <p className="text-xs text-slate-500 max-w-xl leading-snug">
                  Ouvre l&apos;onglet <strong className="text-slate-700">Chat</strong> en mode CIO, avec le fil lié à la mission{" "}
                  <span className="font-mono text-slate-600">
                    #{detail.parent_job_id || detail.job_id}
                  </span>{" "}
                  {detail.parent_job_id ? (
                    <>
                      (d’origine — les tours « chat » restent regroupés sur cette mission dans le journal).
                    </>
                  ) : (
                    <>et la synthèse (ou la consigne) reprise comme point de départ.</>
                  )}
                </p>
              </div>
            ) : null}

            {detail.source === "chat" && (
              <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-2 py-0.5 mb-3">
                Chat CIO
              </span>
            )}

            {detail.result && detail.status !== "running" ? (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Synthèse (résultat)</p>
                <MemoMarkdown content={detail.result} className="prose prose-sm prose-slate max-w-none" />
              </div>
            ) : null}

            {detail.result && detail.status === "running" ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-3 mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  Brouillon / résultat partiel
                </p>
                <MemoMarkdown content={detail.result} className="prose prose-sm prose-slate max-w-none" />
              </div>
            ) : null}

            <MissionProcessPreview team={detail.team} events={detail.events} plan={detail.plan} />

            <MissionThreadView
              thread={detail.mission_thread}
              count={detail.mission_thread_count}
              events={detail.events}
              plan={detail.plan}
              threadMode="lead_focus"
              focusAgent={detail.agent || "coordinateur"}
            />

            <CollapsibleBand
              className="mt-3"
              bandId={`hist-${detail.job_id}-consigne`}
              title="Consigne / mission demandée"
              subtitle="Texte initial envoyé à l’équipe (repliable)."
              open={histConsigneOpen}
              onToggle={() => setHistConsigneOpen((v) => !v)}
              bodyClassName="px-4 pb-4 border-t border-slate-100 bg-slate-50/50"
            >
              <div className="rounded-xl border border-emerald-200/90 bg-gradient-to-br from-emerald-50/90 to-white px-3 py-2.5 mt-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 mb-1.5">
                  Mission demandée
                </p>
                <p className="text-sm text-slate-900 leading-relaxed whitespace-pre-wrap">{detail.mission || "—"}</p>
              </div>
            </CollapsibleBand>

            <CollapsibleBand
              className="mt-2"
              bandId={`hist-${detail.job_id}-process`}
              title="Enchaînement du processus"
              subtitle="Flux, livrables intermédiaires et journal complet — l’aperçu des rôles est au-dessus du journal."
              open={histProcessOpen}
              onToggle={() => setHistProcessOpen((v) => !v)}
              bodyClassName="px-4 pb-4 border-t border-slate-100 space-y-3 pt-3 bg-slate-50/40"
            >
              <TeamTrack team={detail.team} />
              <InteractionFlow events={detail.events} plan={detail.plan} />
              {detail.agent === "coordinateur" ? (
                <MissionThreadView
                  thread={detail.mission_thread}
                  count={detail.mission_thread_count}
                  events={detail.events}
                  plan={detail.plan}
                  threadMode="full"
                  focusAgent="coordinateur"
                />
              ) : null}
            </CollapsibleBand>

            {detail.status === "completed" &&
              (detail.source || "mission") === "mission" &&
              !detail.user_validated_at &&
              (detail.mission_config?.require_user_validation !== false) && (
                <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 space-y-2">
                  <p className="text-xs text-sky-950 leading-relaxed">
                    Cette mission attend encore ta <strong>validation explicite</strong> pour être considérée comme
                    clôturée côté dirigeant.
                  </p>
                  <label className="flex items-start gap-2 text-xs text-sky-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hvChecked}
                      onChange={(e) => setHvChecked(e.target.checked)}
                      className="mt-0.5 rounded border-sky-400"
                    />
                    <span>Je valide cette mission (synthèse et livrables acceptés pour l’instant).</span>
                  </label>
                  {hvErr ? <p className="text-xs text-red-700">{hvErr}</p> : null}
                  <button
                    type="button"
                    disabled={!hvChecked || hvBusy}
                    onClick={validateHistoryMission}
                    className="text-sm font-medium bg-sky-900 text-white px-4 py-2 rounded-lg hover:bg-sky-950 disabled:opacity-40 cursor-pointer"
                  >
                    {hvBusy ? "Enregistrement…" : "Valider la mission"}
                  </button>
                  <p className="text-[11px] text-sky-800/90">
                    Pour itérer avec le CIO avant de valider : bouton <strong>« Reprendre avec le CIO »</strong> en haut
                    de ce panneau, ou lien équivalent depuis la carte mission (onglet <strong>Mission en cours</strong>
                    ).
                  </p>
                </div>
              )}
            {detail.user_validated_at && (detail.source || "mission") === "mission" ? (
              <p className="mt-3 text-xs text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
                Mission <strong>validée par le dirigeant</strong> le{" "}
                {String(detail.user_validated_at).replace("T", " ").slice(0, 19)} UTC.
              </p>
            ) : null}

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/90 overflow-hidden">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setHistoryTechOpen((o) => !o);
                }}
                className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left hover:bg-slate-100/80 cursor-pointer transition-colors"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-800">Détails techniques</p>
                  <p className="text-xs text-slate-500 mt-0.5 leading-snug">
                    Observabilité, logs enregistrés et métriques tokens.
                  </p>
                </div>
                <span className="text-slate-400 text-sm shrink-0" aria-hidden>
                  {historyTechOpen ? "▼" : "▶"}
                </span>
              </button>
              {historyTechOpen && (
                <div className="border-t border-slate-200 px-4 py-4 space-y-4">
                  {(detail.tokens_total > 0 || Number(detail.cost_usd) > 0) && (
                    <p className="text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">Métriques :</span>{" "}
                      <span className="font-mono">{detail.tokens_total?.toLocaleString() || 0} tok</span>
                      {detail.cost_usd != null && (
                        <>
                          {" "}
                          · <span className="font-mono">${detail.cost_usd}</span>
                        </>
                      )}
                    </p>
                  )}
                  <ObservabilityPanel plan={detail.plan} events={detail.events} defaultOpen={false} />
                  {detail.logs?.length > 0 ? (
                    <div className="bg-[#0d1117] rounded-xl p-4 max-h-56 overflow-y-auto font-mono text-xs border border-slate-800">
                      {detail.logs.map((l, i) => (
                        <div key={i} className="text-slate-300">
                          {l}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">Aucune ligne de log persistée pour cette entrée.</p>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page Mission (lancement direct) ───────────────────────────────────────────
export function MissionNouvellePage() {
  const [searchParams] = useSearchParams();
  const preAgent = searchParams.get("agent") || "coordinateur";
  const [agents, setAgents] = useState([]);
  const agentWorkload = useAgentWorkloadPoll();

  useEffect(() => {
    fetch(`${API}/agents`)
      .then((r) => r.json())
      .then((d) => setAgents(d.agents || []))
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Nouvelle mission</h1>
          <p className="text-sm text-slate-500 mt-1">Lancer une nouvelle exécution (hors cadrage guidé).</p>
        </div>
        <Link
          to="/mission/guided"
          className="shrink-0 inline-flex items-center justify-center text-sm font-medium bg-violet-900 text-white px-4 py-2 rounded-lg hover:bg-violet-800 transition-colors"
        >
          Mission guidée — cadrer d’abord
        </Link>
      </div>
      <MissionsTab
        agents={agents}
        highlightJobId={null}
        agentWorkload={agentWorkload}
        mode="launch"
        initialAgentKey={preAgent}
      />
    </div>
  );
}

function AgentOverviewCard({ agentKey, label, busy, tasks, onOpenMissions }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm overflow-hidden ${
        busy ? "border-amber-200 ring-1 ring-amber-100/80" : "border-slate-200"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="w-full px-4 py-3 flex flex-wrap items-center gap-2 text-left hover:bg-slate-50/80 cursor-pointer"
      >
        <span className="text-xl shrink-0">{ICONS[agentKey] || "🤖"}</span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 truncate">{label}</p>
          <p className="text-[11px] text-slate-500 font-mono truncate">{agentKey}</p>
        </div>
        <span
          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-full shrink-0 ${
            busy ? "bg-amber-100 text-amber-900" : "bg-slate-100 text-slate-600"
          }`}
        >
          {busy ? "En activité" : "Disponible"}
        </span>
        <span className="shrink-0 text-xs font-semibold text-slate-700 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 select-none">
          {open ? "Réduire" : "Détail"}
        </span>
      </button>
      {open ? (
        <div className="px-4 pb-3 border-t border-slate-100 bg-slate-50/60">
          {tasks.length === 0 ? (
            <p className="text-xs text-slate-600 pt-3 leading-relaxed">
              Aucune mission <strong>running</strong> ne cible cet agent pour l’instant.
            </p>
          ) : (
            <ul className="pt-3 space-y-2.5">
              {tasks.map((t, i) => (
                <li key={`${t.jobId}-${i}`}>
                  <Link
                    to={`/dashboard?tab=missions&job=${encodeURIComponent(t.jobId)}`}
                    onClick={onOpenMissions}
                    className="block rounded-xl border border-white bg-white px-3 py-2 shadow-sm hover:border-slate-300 hover:shadow transition-colors"
                  >
                    <span className="text-[10px] font-mono text-slate-500">#{t.jobId}</span>
                    <p className="text-sm text-slate-900 leading-snug mt-0.5">{t.title}</p>
                    {t.subtitle ? (
                      <p className="text-xs text-slate-500 mt-1 leading-snug line-clamp-3">{t.subtitle}</p>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── Vue d'ensemble (pilotage multi-agents) ───────────────────────────────────
function DashboardOverview({
  agents,
  jobs,
  activityByAgent,
  tokens,
  llmInfo,
  backendStatus,
  backendHint,
  onOpenMissions,
}) {
  const running = useMemo(() => jobs.filter((j) => j.status === "running").length, [jobs]);
  const completed = useMemo(() => jobs.filter((j) => j.status === "completed").length, [jobs]);
  const failed = useMemo(
    () => jobs.filter((j) => j.status === "failed" || j.status === "error").length,
    [jobs],
  );
  const busyAgents = useMemo(() => {
    const m = activityByAgent || {};
    return Object.keys(m).filter((k) => (m[k] || []).length > 0);
  }, [activityByAgent]);

  const taskRowsByAgent = useMemo(
    () => buildAgentTaskRows(jobs.filter((j) => j.status === "running")),
    [jobs],
  );
  const agentKeysOrdered = useMemo(() => {
    const keys = new Set((agents || []).map((a) => a.key));
    Object.keys(taskRowsByAgent || {}).forEach((k) => keys.add(k));
    const order = (agents || []).map((a) => a.key);
    const rest = [...keys].filter((k) => !order.includes(k)).sort();
    return [...order, ...rest];
  }, [agents, taskRowsByAgent]);

  const card = "bg-white border border-slate-200 rounded-2xl p-4 shadow-sm";
  const cardTitle = "text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2";

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600 max-w-2xl">
        Pilotage de l’orchestration : état du backend, modèle LLM, consommation, file de missions et charge par
        agent. Passe à l’onglet <strong>Mission en cours</strong> pour le suivi détaillé, le chat et l’historique.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className={card}>
          <p className={cardTitle}>Plateforme</p>
          <div className="flex items-center gap-2">
            <StatusDot status={backendStatus} title={backendHint} />
            <span className="text-sm text-slate-700">
              {backendStatus === "ok" ? "API joignable" : backendStatus === "loading" ? "Vérification…" : "Problème"}
            </span>
          </div>
          {backendHint ? <p className="text-xs text-slate-500 mt-2 leading-relaxed">{backendHint}</p> : null}
        </div>

        <div className={card}>
          <p className={cardTitle}>Modèle LLM</p>
          {llmInfo ? (
            <p className="text-sm font-mono text-slate-800">
              {llmInfo.provider} · {llmInfo.model}
            </p>
          ) : (
            <p className="text-sm text-slate-400">Non chargé</p>
          )}
        </div>

        <div className={card}>
          <p className={cardTitle}>Crédits (tokens)</p>
          <TokenWidget tokens={tokens} />
        </div>

        <div className={card}>
          <p className={cardTitle}>Équipe d’agents</p>
          <p className="text-2xl font-bold text-slate-900">{agents.length}</p>
          <p className="text-xs text-slate-500 mt-1">
            {agents.length
              ? agents
                  .map((a) => a.label || a.key)
                  .slice(0, 6)
                  .join(" · ")
              : "—"}
            {agents.length > 6 ? "…" : ""}
          </p>
        </div>

        <div className={card}>
          <p className={cardTitle}>File de missions</p>
          <p className="text-sm text-slate-800">
            <span className="font-semibold text-slate-900">{jobs.length}</span> au total ·{" "}
            <span className="text-emerald-700 font-medium">{running} en cours</span>
            {completed > 0 ? (
              <>
                {" "}
                · <span className="text-slate-600">{completed} terminées</span>
              </>
            ) : null}
            {failed > 0 ? (
              <>
                {" "}
                · <span className="text-red-600">{failed} en échec</span>
              </>
            ) : null}
          </p>
          {busyAgents.length > 0 ? (
            <p className="text-xs text-slate-500 mt-2">
              {busyAgents.length} agent{busyAgents.length > 1 ? "s" : ""} avec activité en cours — détail ci-dessous.
            </p>
          ) : null}
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-900 tracking-tight">État des agents</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
            Pour chaque rôle : disponible ou en activité, et la liste des missions / sous-tâches en cours (clic pour
            ouvrir le suivi sur <strong>Mission en cours</strong>).
          </p>
        </div>
        {agentKeysOrdered.length === 0 ? (
          <p className="text-sm text-slate-500 border border-dashed border-slate-200 rounded-2xl px-4 py-6 text-center">
            Aucun agent configuré pour le moment.
          </p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {agentKeysOrdered.map((key) => {
              const meta = agents.find((a) => a.key === key);
              const tasks = taskRowsByAgent[key] || [];
              const busy = tasks.length > 0;
              const label = meta?.label || AGENT_LABELS[key] || key;
              return (
                <AgentOverviewCard
                  key={key}
                  agentKey={key}
                  label={label}
                  busy={busy}
                  tasks={tasks}
                  onOpenMissions={onOpenMissions}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          to="/mission/nouvelle"
          className="inline-flex items-center justify-center text-sm font-medium bg-slate-900 text-white px-4 py-2 rounded-lg hover:bg-slate-800 transition-colors"
        >
          Nouvelle mission
        </Link>
        <Link
          to="/mission/guided"
          className="inline-flex items-center justify-center text-sm font-medium bg-violet-900 text-white px-4 py-2 rounded-lg hover:bg-violet-800 transition-colors"
        >
          Mission guidée
        </Link>
        <button
          type="button"
          onClick={onOpenMissions}
          className="inline-flex items-center justify-center text-sm font-medium border border-slate-300 bg-white text-slate-800 px-4 py-2 rounded-lg hover:bg-slate-50 transition-colors"
        >
          Mission en cours — suivi, chat et historique
        </button>
      </div>
    </div>
  );
}

// ── Dashboard principal ──────────────────────────────────────────────────────
export default function Dashboard() {
  const [searchParams, setSearchParams]   = useSearchParams();
  const [pane, setPane]                   = useState("overview");
  const [tab, setTab]                     = useState("missions");
  const [highlightJobId, setHighlightJobId] = useState(null);
  const [followJobSeedId, setFollowJobSeedId] = useState(null);
  const [backendStatus, setBackendStatus] = useState("loading");
  const [backendHint, setBackendHint]     = useState("");
  const [toolsHealth, setToolsHealth]     = useState(null);
  const [toolsHealthErr, setToolsHealthErr] = useState("");
  const [agents, setAgents]               = useState([]);
  const [tokens, setTokens]               = useState(null);
  const [llmInfo, setLlmInfo]             = useState(null);
  const agentWorkload                     = useAgentWorkloadPoll();

  const checkHealth = useCallback(async () => {
    const ac = new AbortController();
    const tid = setTimeout(() => ac.abort(), 12_000);
    try {
      const res = await fetch(`${API}/health`, { signal: ac.signal });
      if (res.ok) {
        setBackendStatus("ok");
        setBackendHint("");
      } else {
        setBackendStatus("error");
        setBackendHint(
          `Réponse HTTP ${res.status} sur /health — le proxy pointe peut-être vers un autre service que Korymb (${import.meta.env.VITE_PROXY_TARGET || "?"})`,
        );
      }
    } catch (e) {
      setBackendStatus("error");
      setBackendHint(networkErrorMessage(e));
    } finally {
      clearTimeout(tid);
    }
  }, []);

  const fetchToolsHealth = useCallback(async (refresh) => {
    setToolsHealthErr("");
    try {
      setToolsHealth(await fetchToolsHealthPayload(API, refresh));
    } catch (e) {
      setToolsHealthErr(networkErrorMessage(e) || String(e));
      setToolsHealth(null);
    }
  }, []);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${API}/tokens`);
      if (res.ok) setTokens(await res.json());
    } catch {}
  }, []);

  const reloadLlm = useCallback(() => {
    fetch(`${API}/llm`).then(r => r.json()).then(setLlmInfo).catch(() => setLlmInfo(null));
  }, []);

  useEffect(() => {
    checkHealth();
    fetchToolsHealth(false);
    fetch(`${API}/agents`).then(r=>r.json()).then(d=>setAgents(d.agents||[])).catch(()=>{});
    reloadLlm();
    fetchTokens();
    const t1 = setInterval(checkHealth, 30_000);
    const t2 = setInterval(fetchTokens, 15_000);
    const t3 = setInterval(() => fetchToolsHealth(false), 120_000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      clearInterval(t3);
    };
  }, [checkHealth, fetchToolsHealth, fetchTokens, reloadLlm]);

  const clearFollowJobSeed = useCallback(() => setFollowJobSeedId(null), []);

  const openOverview = useCallback(() => {
    setPane("overview");
    const u = new URLSearchParams(searchParams);
    u.delete("tab");
    setSearchParams(u, { replace: true });
  }, [searchParams, setSearchParams]);

  const openMissionsPane = useCallback(() => {
    setPane("missions");
  }, []);

  useEffect(() => {
    const jobQ = searchParams.get("job");
    const follow = searchParams.get("followJob");
    const tabq = searchParams.get("tab");
    if (tabq === "missions" || tabq === "chat" || tabq === "history" || tabq === "config") {
      setTab(tabq);
      setPane("missions");
    }
    const u = new URLSearchParams(searchParams);
    let timer;
    if (follow) {
      setPane("missions");
      setTab("chat");
      setFollowJobSeedId(follow);
      u.delete("followJob");
      u.delete("tab");
      setSearchParams(u, { replace: true });
      return undefined;
    }
    if (jobQ) {
      setPane("missions");
      setTab("missions");
      setHighlightJobId(jobQ);
      timer = setTimeout(() => {
        document.querySelector(`[data-job-card="${jobQ}"]`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }, 400);
      u.delete("job");
      u.delete("tab");
      setSearchParams(u, { replace: true });
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [searchParams, setSearchParams]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard</h1>
          <p className="text-sm text-slate-500 mt-1">Quartier général · Entreprise virtuelle · Élude In Art</p>
          {llmInfo && (
            <p className="text-xs text-slate-400 mt-1 font-mono">
              LLM : {llmInfo.provider} · {llmInfo.model}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <TokenWidget tokens={tokens}/>
          <StatusDot status={backendStatus} title={backendHint}/>
        </div>
      </div>

      <ResearchTierCostBanner tokens={tokens} />
      <ToolsConnectivityBanner
        data={toolsHealth}
        fetchError={toolsHealthErr}
        onRecheck={() => fetchToolsHealth(true)}
      />

      <div className="flex gap-1 p-1 bg-slate-100/90 rounded-xl w-fit border border-slate-200/80">
        <button
          type="button"
          onClick={openOverview}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
            pane === "overview"
              ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Vue d&apos;ensemble
        </button>
        <button
          type="button"
          onClick={openMissionsPane}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer ${
            pane === "missions"
              ? "bg-white text-slate-900 shadow-sm border border-slate-200/80"
              : "text-slate-600 hover:text-slate-900"
          }`}
        >
          Mission en cours
        </button>
      </div>

      {pane === "overview" && (
        <DashboardOverview
          agents={agents}
          jobs={agentWorkload.jobs || []}
          activityByAgent={agentWorkload.activityByAgent}
          tokens={tokens}
          llmInfo={llmInfo}
          backendStatus={backendStatus}
          backendHint={backendHint}
          onOpenMissions={openMissionsPane}
        />
      )}

      {pane === "missions" && (
        <>
          <Tabs active={tab} onChange={setTab}/>

          {tab === "missions" && (
            <MissionsTab
              agents={agents}
              highlightJobId={highlightJobId}
              agentWorkload={agentWorkload}
              mode="tracking"
            />
          )}
          {tab === "chat" && (
            <ChatTab
              agents={agents}
              seedFollowJobId={followJobSeedId}
              onConsumeSeedFollowJob={clearFollowJobSeed}
              agentWorkload={agentWorkload}
            />
          )}
          {tab === "history" && (
            <HistoryTab
              onResumeWithCio={(jobId) => {
                setFollowJobSeedId(jobId);
                setTab("chat");
              }}
            />
          )}
          {tab === "config"   && <ConfigTab onSaved={() => { reloadLlm(); fetchTokens(); }}/>}
        </>
      )}
    </div>
  );
}
