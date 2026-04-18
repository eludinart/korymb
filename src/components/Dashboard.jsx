import React, { useState, useEffect, useCallback, useRef } from "react";
import { marked } from "marked";

const API    = import.meta.env.VITE_AI_BACKEND_URL || "http://localhost:8002";
const SECRET = import.meta.env.VITE_AGENT_SECRET   || "";

function authHeaders() {
  return { "Content-Type": "application/json", "X-Agent-Secret": SECRET };
}

const ICONS = {
  commercial: "💼", community_manager: "📣",
  developpeur: "💻", comptable: "📊", coordinateur: "🧭",
};

// ── Widgets ─────────────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const cfg = {
    ok:      { dot: "bg-emerald-500", text: "text-emerald-700", label: "Connecté" },
    error:   { dot: "bg-red-500",     text: "text-red-700",     label: "Inaccessible" },
    loading: { dot: "bg-amber-400 animate-pulse", text: "text-amber-700", label: "…" },
  };
  const { dot, text, label } = cfg[status] || cfg.loading;
  return (
    <span className={`flex items-center gap-1.5 text-xs font-medium ${text}`}>
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
  return (
    <div className="flex items-center gap-3 text-xs text-slate-500 border border-slate-200 rounded-xl px-3 py-2">
      <div>
        <div className="font-semibold text-slate-700">{tokens.total.toLocaleString()} tokens</div>
        <div className="text-slate-400">${tokens.cost_usd} aujourd'hui</div>
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

// ── Onglets ─────────────────────────────────────────────────────────────────
function Tabs({ active, onChange }) {
  const tabs = [["missions","Missions"],["chat","Chat"],["history","Historique"]];
  return (
    <div className="flex gap-0 border-b border-slate-200">
      {tabs.map(([key,label]) => (
        <button key={key} onClick={() => onChange(key)}
          className={`px-5 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer
            ${active===key ? "border-slate-900 text-slate-900" : "border-transparent text-slate-400 hover:text-slate-600"}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Sélecteur d'agent ────────────────────────────────────────────────────────
function AgentGrid({ agents, selected, onSelect }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
      {agents.map(a => (
        <button key={a.key} onClick={() => onSelect(a.key)}
          className={`flex flex-col gap-1 p-3 rounded-xl border text-left transition-all cursor-pointer
            ${selected===a.key ? "bg-slate-900 border-slate-900 text-white shadow-md" : "bg-white border-slate-200 hover:border-slate-400"}`}>
          <span className="text-xl">{ICONS[a.key]||"🤖"}</span>
          <span className={`text-sm font-semibold mt-1 ${selected===a.key?"text-white":"text-slate-800"}`}>{a.label}</span>
          <span className={`text-xs ${selected===a.key?"text-slate-400":"text-slate-400"}`}>{a.role}</span>
          {a.is_manager && (
            <span className={`text-xs font-medium mt-1 px-1.5 py-0.5 rounded-full w-fit
              ${selected===a.key?"bg-slate-700 text-slate-200":"bg-amber-100 text-amber-700"}`}>
              orchestrateur
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ── Terminal logs ────────────────────────────────────────────────────────────
function LogPanel({ jobId, isRunning, onUpdate }) {
  const [logs, setLogs]   = useState([]);
  const offsetRef         = useRef(0);
  const bottomRef         = useRef(null);

  useEffect(() => {
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${API}/jobs/${jobId}?log_offset=${offsetRef.current}`, { headers: authHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (data.logs?.length) {
          setLogs(p => [...p, ...data.logs]);
          offsetRef.current = data.log_total;
        }
        if (data.status !== "running") onUpdate(data);
        else if (!stopped) setTimeout(poll, 1500);
      } catch {}
    };
    poll();
    return () => { stopped = true; };
  }, [jobId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [logs]);

  const lineColor = l =>
    l.startsWith("[korymb] Mission démarrée") ? "text-sky-400" :
    l.includes("terminée") || l.startsWith("✓") ? "text-emerald-400" :
    l.startsWith("[korymb] Erreur") || l.includes("⚠️") ? "text-red-400" :
    l.includes("tokens") ? "text-violet-400" :
    "text-slate-300";

  return (
    <div className="mt-3 rounded-xl bg-[#0d1117] overflow-hidden border border-slate-800">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-slate-800">
        <span className="w-3 h-3 rounded-full bg-red-500/70"/><span className="w-3 h-3 rounded-full bg-amber-400/70"/><span className="w-3 h-3 rounded-full bg-emerald-500/70"/>
        <span className="ml-2 text-xs text-slate-500 font-mono">#{jobId}</span>
        {isRunning && <span className="ml-auto text-xs text-amber-400 animate-pulse">live</span>}
      </div>
      <div className="p-4 max-h-64 overflow-y-auto font-mono text-xs leading-relaxed">
        {logs.length===0
          ? <span className="text-slate-600">En attente de sortie…</span>
          : logs.map((l,i) => <div key={i} className={lineColor(l)}>{l}</div>)
        }
        <div ref={bottomRef}/>
      </div>
    </div>
  );
}

// ── Carte job ────────────────────────────────────────────────────────────────
function JobCard({ job: init }) {
  const [job, setJob]         = useState(init);
  const [showLogs, setShowLogs] = useState(true);
  const isRunning = job.status === "running";
  const isError   = job.status.startsWith("error");
  const statusCls = isRunning ? "bg-amber-100 text-amber-700"
                  : isError   ? "bg-red-100 text-red-700"
                  : "bg-emerald-100 text-emerald-700";
  const statusLabel = isRunning ? "En cours" : isError ? "Erreur" : "Terminé";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{ICONS[job.agent]||"🤖"}</span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-slate-800">{job.agent}</span>
              <span className="font-mono text-xs text-slate-400">#{job.job_id}</span>
              {job.tokens_total > 0 && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                  ${job.token_alert ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                  {job.tokens_total?.toLocaleString()} tok · ${job.cost_usd}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mt-0.5">{job.mission}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setShowLogs(v=>!v)}
            className="text-xs text-slate-400 hover:text-slate-700 border border-slate-200 rounded-lg px-3 py-1 cursor-pointer">
            {showLogs ? "▲ logs" : "▼ logs"}
          </button>
          <span className={`text-xs font-semibold px-3 py-1 rounded-full ${statusCls}`}>{statusLabel}</span>
        </div>
      </div>

      {showLogs && (
        <LogPanel jobId={job.job_id} isRunning={isRunning}
          onUpdate={d => setJob(j => ({ ...j, status: d.status, tokens_in: d.tokens_in,
            tokens_out: d.tokens_out, tokens_total: d.tokens_total, cost_usd: d.cost_usd,
            token_alert: d.token_alert, result: d.result }))}
        />
      )}

      {job.result && !isRunning && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Résultat</p>
          <div className="prose prose-sm prose-slate max-w-none"
            dangerouslySetInnerHTML={{ __html: marked.parse(job.result) }}/>
        </div>
      )}
    </div>
  );
}

// ── Onglet Missions ──────────────────────────────────────────────────────────
function MissionsTab({ agents }) {
  const [selectedAgent, setSelectedAgent] = useState("coordinateur");
  const [mission, setMission]             = useState("");
  const [jobs, setJobs]                   = useState([]);
  const [sending, setSending]             = useState(false);
  const [error, setError]                 = useState("");
  const currentAgent = agents.find(a => a.key === selectedAgent);

  const handleSubmit = async e => {
    e.preventDefault();
    if (!mission.trim()) return;
    setError(""); setSending(true);
    try {
      const res = await fetch(`${API}/run`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ mission: mission.trim(), agent: selectedAgent }),
      });
      if (!res.ok) throw new Error((await res.json().catch(()=>({}))).detail || `Erreur ${res.status}`);
      const data = await res.json();
      setJobs(p => [{ job_id: data.job_id, status: "running", agent: data.agent, mission: mission.trim(), result: null }, ...p]);
      setMission("");
    } catch(err) { setError(err.message); }
    finally { setSending(false); }
  };

  return (
    <div className="flex flex-col gap-6">
      {agents.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Choisir un agent</p>
          <AgentGrid agents={agents} selected={selectedAgent} onSelect={setSelectedAgent}/>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-4">
          Nouvelle mission
          {currentAgent && <span className="ml-2 normal-case font-medium text-slate-600 tracking-normal">→ {currentAgent.label}</span>}
          {currentAgent?.is_manager && <span className="ml-2 text-amber-600 normal-case font-medium tracking-normal">· orchestration multi-agents</span>}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <textarea rows={4}
            className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm resize-none outline-none focus:border-slate-400 bg-slate-50 placeholder:text-slate-400"
            placeholder={`Instruis ${currentAgent?.label||"l'agent"} en langage naturel…`}
            value={mission} onChange={e=>setMission(e.target.value)} disabled={sending}/>
          {error && <p className="text-sm text-red-500">{error}</p>}
          <div className="flex justify-end">
            <button type="submit" disabled={sending}
              className="bg-slate-900 text-white text-sm font-medium px-6 py-2.5 rounded-xl hover:bg-slate-700 transition-colors disabled:opacity-40 cursor-pointer">
              {sending ? "Envoi…" : "Lancer →"}
            </button>
          </div>
        </form>
      </div>

      {jobs.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">
            Missions en session <span className="bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 normal-case text-xs ml-1">{jobs.length}</span>
          </p>
          <div className="flex flex-col gap-4">
            {jobs.map(j => <JobCard key={j.job_id} job={j}/>)}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Onglet Chat ──────────────────────────────────────────────────────────────
function ChatTab({ agents }) {
  const [selectedAgent, setSelectedAgent] = useState("coordinateur");
  const [input, setInput]                 = useState("");
  const [history, setHistory]             = useState([]);
  const [loading, setLoading]             = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [history]);

  const send = async e => {
    e.preventDefault();
    if (!input.trim() || loading) return;
    const msg = input.trim();
    setInput("");
    const newHistory = [...history, { role: "user", content: msg }];
    setHistory(newHistory);
    setLoading(true);
    try {
      const res = await fetch(`${API}/chat`, {
        method: "POST", headers: authHeaders(),
        body: JSON.stringify({ message: msg, agent: selectedAgent, history }),
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const data = await res.json();
      setHistory(p => [...p, { role: "assistant", content: data.response, agent: selectedAgent }]);
    } catch(err) {
      setHistory(p => [...p, { role: "assistant", content: `Erreur : ${err.message}`, agent: selectedAgent }]);
    }
    setLoading(false);
  };

  const currentAgent = agents.find(a => a.key === selectedAgent);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 mb-3">Parler à</p>
        <AgentGrid agents={agents} selected={selectedAgent} onSelect={a => { setSelectedAgent(a); setHistory([]); }}/>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        {/* Messages */}
        <div className="p-5 min-h-64 max-h-[500px] overflow-y-auto flex flex-col gap-4">
          {history.length === 0 && (
            <div className="text-center text-slate-400 text-sm pt-8">
              <span className="text-4xl block mb-3">{ICONS[selectedAgent]||"🤖"}</span>
              Commence une conversation avec {currentAgent?.label}
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
                {m.role === "assistant"
                  ? <div className="prose prose-sm max-w-none prose-slate"
                      dangerouslySetInnerHTML={{ __html: marked.parse(m.content) }}/>
                  : m.content
                }
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <span className="text-xl mr-2">{ICONS[selectedAgent]||"🤖"}</span>
              <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-4 py-3">
                <span className="text-slate-400 text-sm animate-pulse">En train de réfléchir…</span>
              </div>
            </div>
          )}
          <div ref={bottomRef}/>
        </div>

        {/* Input */}
        <form onSubmit={send} className="border-t border-slate-100 p-4 flex gap-3">
          <input
            className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-slate-400 bg-slate-50"
            placeholder={`Message à ${currentAgent?.label||"l'agent"}…`}
            value={input} onChange={e=>setInput(e.target.value)} disabled={loading}/>
          <button type="submit" disabled={loading||!input.trim()}
            className="bg-slate-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-slate-700 disabled:opacity-40 cursor-pointer">
            Envoyer
          </button>
        </form>
      </div>

      <p className="text-xs text-slate-400">
        Le chat est direct et synchrone. Pour des tâches longues, utilise l'onglet Missions.
      </p>
    </div>
  );
}

// ── Onglet Historique ────────────────────────────────────────────────────────
function HistoryTab() {
  const [jobs, setJobs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail]     = useState(null);

  useEffect(() => {
    fetch(`${API}/jobs`, { headers: authHeaders() })
      .then(r => r.json())
      .then(d => { setJobs(d.jobs||[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!selected) return;
    fetch(`${API}/jobs/${selected}`, { headers: authHeaders() })
      .then(r => r.json()).then(setDetail).catch(()=>{});
  }, [selected]);

  const statusCls = s =>
    s==="completed" ? "bg-emerald-100 text-emerald-700" :
    s?.startsWith("error") ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700";
  const statusLabel = s =>
    s==="completed" ? "Terminé" : s?.startsWith("error") ? "Erreur" : "En cours";

  if (loading) return <p className="text-sm text-slate-400">Chargement…</p>;
  if (!jobs.length) return <p className="text-sm text-slate-400">Aucune mission enregistrée.</p>;

  return (
    <div className="flex gap-4">
      <div className="w-72 shrink-0 flex flex-col gap-2 max-h-[600px] overflow-y-auto pr-1">
        {jobs.map(j => (
          <button key={j.job_id} onClick={() => setSelected(j.job_id)}
            className={`text-left border rounded-xl px-4 py-3 transition-all cursor-pointer
              ${selected===j.job_id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-400"}`}>
            <div className="flex justify-between items-center mb-1">
              <span className={`text-xs ${selected===j.job_id?"text-slate-300":"text-slate-500"}`}>
                {ICONS[j.agent]||"🤖"} {j.agent}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
                ${selected===j.job_id ? "bg-slate-700 text-slate-200" : statusCls(j.status)}`}>
                {statusLabel(j.status)}
              </span>
            </div>
            <p className={`text-xs truncate ${selected===j.job_id?"text-slate-200":"text-slate-600"}`}>{j.mission}</p>
            <div className={`flex items-center justify-between mt-1 ${selected===j.job_id?"text-slate-400":"text-slate-400"} text-xs`}>
              {j.created_at && <span>{new Date(j.created_at+"Z").toLocaleString("fr-FR")}</span>}
              {(j.tokens_in||j.tokens_out) ? <span>{(j.tokens_in+j.tokens_out).toLocaleString()} tok</span> : null}
            </div>
          </button>
        ))}
      </div>

      <div className="flex-1 min-w-0">
        {!selected && <p className="text-sm text-slate-400 pt-2">Sélectionne une mission.</p>}
        {selected && !detail && <p className="text-sm text-slate-400">Chargement…</p>}
        {detail && (
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">{ICONS[detail.agent]||"🤖"}</span>
              <span className="font-semibold text-slate-800">{detail.agent}</span>
              <span className="font-mono text-xs text-slate-400">#{detail.job_id}</span>
              {detail.tokens_total > 0 && (
                <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                  {detail.tokens_total?.toLocaleString()} tok · ${detail.cost_usd}
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 mb-4">{detail.mission}</p>
            {detail.logs?.length > 0 && (
              <div className="mb-4 bg-[#0d1117] rounded-xl p-4 max-h-40 overflow-y-auto font-mono text-xs">
                {detail.logs.map((l,i) => <div key={i} className="text-slate-300">{l}</div>)}
              </div>
            )}
            {detail.result && (
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Résultat</p>
                <div className="prose prose-sm prose-slate max-w-none"
                  dangerouslySetInnerHTML={{ __html: marked.parse(detail.result) }}/>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard principal ──────────────────────────────────────────────────────
export default function Dashboard() {
  const [tab, setTab]                     = useState("missions");
  const [backendStatus, setBackendStatus] = useState("loading");
  const [agents, setAgents]               = useState([]);
  const [tokens, setTokens]               = useState(null);

  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/health`);
      setBackendStatus(res.ok ? "ok" : "error");
    } catch { setBackendStatus("error"); }
  }, []);

  const fetchTokens = useCallback(async () => {
    try {
      const res = await fetch(`${API}/tokens`);
      if (res.ok) setTokens(await res.json());
    } catch {}
  }, []);

  useEffect(() => {
    checkHealth();
    fetch(`${API}/agents`).then(r=>r.json()).then(d=>setAgents(d.agents||[])).catch(()=>{});
    fetchTokens();
    const t1 = setInterval(checkHealth, 30_000);
    const t2 = setInterval(fetchTokens, 15_000);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [checkHealth, fetchTokens]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Quartier Général</h1>
          <p className="text-sm text-slate-500 mt-1">Entreprise virtuelle · Élude In Art</p>
        </div>
        <div className="flex items-center gap-3">
          <TokenWidget tokens={tokens}/>
          <StatusDot status={backendStatus}/>
        </div>
      </div>

      <Tabs active={tab} onChange={setTab}/>

      {tab === "missions" && <MissionsTab agents={agents}/>}
      {tab === "chat"     && <ChatTab agents={agents}/>}
      {tab === "history"  && <HistoryTab/>}
    </div>
  );
}
