import React, { useState, useEffect, useCallback, useRef } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { API, authHeaders } from "../korymbApi";
import { MemoMarkdown } from "./MemoMarkdown";

const ICONS = {
  commercial: "💼",
  community_manager: "📣",
  developpeur: "💻",
  comptable: "📊",
  coordinateur: "🧭",
};

function networkErrorMessage(err) {
  const m = err?.message || String(err);
  if (/failed to fetch|networkerror|load failed/i.test(m)) {
    return "Connexion au serveur impossible. Vérifie le backend et le proxy /api.";
  }
  return m;
}

export default function MissionCadrage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preAgent = searchParams.get("agent") || "coordinateur";

  const [agents, setAgents] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [session, setSession] = useState(null);
  const [title, setTitle] = useState("");
  const [agent, setAgent] = useState(preAgent);
  const [initialMessage, setInitialMessage] = useState("");
  const [draftMessage, setDraftMessage] = useState("");
  const [briefOverride, setBriefOverride] = useState("");
  const [mcRecursive, setMcRecursive] = useState(false);
  const [mcRounds, setMcRounds] = useState(1);
  const [mcRequireValidation, setMcRequireValidation] = useState(true);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const bottomRef = useRef(null);

  const loadSessions = useCallback(() => {
    fetch(`${API}/mission-sessions`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setSessions(d.sessions || []))
      .catch(() => setSessions([]));
  }, []);

  useEffect(() => {
    fetch(`${API}/agents`)
      .then((r) => r.json())
      .then((d) => setAgents(d.agents || []))
      .catch(() => setAgents([]));
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (preAgent && agents.some((a) => a.key === preAgent)) setAgent(preAgent);
  }, [preAgent, agents]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.messages]);

  const openSession = async (id) => {
    setErr("");
    try {
      const res = await fetch(`${API}/mission-sessions/${id}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Session introuvable.");
      setSession(await res.json());
    } catch (e) {
      setErr(networkErrorMessage(e));
    }
  };

  const createSession = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/mission-sessions`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          agent,
          title: title.trim(),
          initial_message: initialMessage.trim() || null,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.detail === "string" ? j.detail : `Erreur ${res.status}`);
      }
      const s = await res.json();
      setSession(s);
      setTitle("");
      setInitialMessage("");
      loadSessions();
    } catch (err2) {
      setErr(networkErrorMessage(err2) || String(err2));
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!session || session.status !== "draft" || !draftMessage.trim() || loading) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch(`${API}/mission-sessions/${session.id}/message`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ message: draftMessage.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.detail === "string" ? j.detail : `Erreur ${res.status}`);
      }
      setSession(await res.json());
      setDraftMessage("");
      loadSessions();
    } catch (err2) {
      setErr(networkErrorMessage(err2) || String(err2));
    } finally {
      setLoading(false);
    }
  };

  const validateAndRun = async () => {
    if (!session || session.status !== "draft" || loading) return;
    if (!window.confirm("Valider cette consigne et lancer l’exécution complète (agents / CIO) ?")) return;
    setErr("");
    setLoading(true);
    try {
      const rounds = mcRecursive ? Math.min(5, Math.max(0, parseInt(String(mcRounds), 10) || 0)) : 0;
      const mission_config = {
        recursive_refinement_enabled: mcRecursive,
        recursive_max_rounds: rounds,
        require_user_validation: mcRequireValidation,
      };
      const res = await fetch(`${API}/mission-sessions/${session.id}/validate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          brief: briefOverride.trim() || null,
          mission_config,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(typeof j.detail === "string" ? j.detail : `Erreur ${res.status}`);
      }
      const data = await res.json();
      setBriefOverride("");
      loadSessions();
      navigate(`/dashboard?tab=missions&job=${encodeURIComponent(data.job_id)}`);
    } catch (err2) {
      setErr(networkErrorMessage(err2) || String(err2));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Mission guidée</h1>
          <p className="text-sm text-slate-600 mt-1 max-w-xl">
            Échange avec le <strong>CIO</strong> ou un <strong>agent</strong> pour cadrer le travail ; quand tu valides, la mission
            part en exécution (comme un lancement depuis le QG). Tu peux surcharger la consigne finale dans le champ prévu.
          </p>
        </div>
        <Link to="/dashboard" className="text-sm font-medium text-slate-600 hover:text-slate-900 underline">
          ← Quartier général
        </Link>
      </div>

      {err && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-2">{err}</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6 items-start">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Sessions</p>
          <button
            type="button"
            onClick={() => {
              setSession(null);
              setErr("");
            }}
            className="w-full text-left text-xs font-medium text-violet-800 hover:text-violet-950 mb-3"
          >
            + Nouvelle session
          </button>
          <ul className="space-y-2 max-h-[420px] overflow-y-auto">
            {sessions.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => openSession(s.id)}
                  className={`w-full text-left rounded-lg border px-2 py-2 text-xs transition-colors cursor-pointer ${
                    session?.id === s.id ? "border-violet-500 bg-violet-50" : "border-slate-100 hover:border-slate-300"
                  }`}
                >
                  <span className="font-mono text-slate-400">#{s.id}</span>
                  <span className="ml-1">{ICONS[s.agent] || ""}</span>
                  <span className="block font-medium text-slate-800 truncate">{s.title || s.agent}</span>
                  <span className={s.status === "draft" ? "text-amber-700" : "text-emerald-700"}>{s.status}</span>
                  {s.linked_job_id ? (
                    <span className="block text-slate-500 font-mono">job {s.linked_job_id}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="space-y-6">
          {!session && (
            <form onSubmit={createSession} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Nouvelle session de cadrage</p>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Titre (optionnel)</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                  placeholder="ex. Campagne LinkedIn Q2"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Agent de cadrage</label>
                <select
                  value={agent}
                  onChange={(e) => setAgent(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm"
                >
                  {agents.map((a) => (
                    <option key={a.key} value={a.key}>
                      {a.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Premier message (optionnel)</label>
                <textarea
                  rows={4}
                  value={initialMessage}
                  onChange={(e) => setInitialMessage(e.target.value)}
                  className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none"
                  placeholder="Décris ton intention ; l’agent répondra pour affiner avant validation."
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="bg-slate-900 text-white text-sm font-medium px-5 py-2.5 rounded-xl hover:bg-slate-800 disabled:opacity-40 cursor-pointer"
              >
                {loading ? "Création…" : "Créer la session"}
              </button>
            </form>
          )}

          {session && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden flex flex-col min-h-[420px]">
              <div className="border-b border-slate-100 px-4 py-3 flex flex-wrap items-center justify-between gap-2 bg-slate-50">
                <div>
                  <span className="font-mono text-xs text-slate-400">#{session.id}</span>
                  <span className="ml-2 text-lg">{ICONS[session.agent]}</span>
                  <span className="ml-1 font-semibold text-slate-800">{session.agent}</span>
                  <span
                    className={`ml-2 text-xs font-semibold px-2 py-0.5 rounded-full ${
                      session.status === "draft" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                    }`}
                  >
                    {session.status}
                  </span>
                </div>
                {session.linked_job_id && (
                  <Link
                    to={`/dashboard?tab=missions&job=${session.linked_job_id}`}
                    className="text-xs font-medium text-violet-800 hover:underline"
                  >
                    Voir le job #{session.linked_job_id} →
                  </Link>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[480px]">
                {(session.messages || []).map((m, i) => (
                  <div
                    key={i}
                    className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[90%] rounded-2xl px-4 py-2.5 text-sm ${
                        m.role === "user"
                          ? "bg-slate-900 text-white rounded-br-md"
                          : "bg-slate-100 text-slate-800 rounded-bl-md prose prose-sm prose-slate max-w-none"
                      }`}
                    >
                      {m.role === "assistant" ? (
                        <MemoMarkdown content={m.content || ""} />
                      ) : (
                        m.content
                      )}
                    </div>
                  </div>
                ))}
                <div ref={bottomRef} />
              </div>

              {session.status === "draft" ? (
                <>
                  <form onSubmit={sendMessage} className="border-t border-slate-100 p-4 flex gap-2">
                    <input
                      value={draftMessage}
                      onChange={(e) => setDraftMessage(e.target.value)}
                      disabled={loading}
                      className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm"
                      placeholder="Répondre pour affiner le cadrage…"
                    />
                    <button
                      type="submit"
                      disabled={loading || !draftMessage.trim()}
                      className="bg-slate-900 text-white text-sm font-medium px-4 py-2 rounded-xl disabled:opacity-40 cursor-pointer"
                    >
                      Envoyer
                    </button>
                  </form>
                  <div className="border-t border-slate-100 p-4 space-y-3 bg-violet-50/50">
                    <p className="text-xs font-semibold text-violet-900 uppercase tracking-wide">
                      Validation & exécution
                    </p>
                    <div className="rounded-lg border border-violet-100 bg-white/80 px-3 py-2 space-y-2 text-xs text-slate-800">
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mcRecursive}
                          onChange={(e) => setMcRecursive(e.target.checked)}
                          disabled={loading}
                          className="mt-0.5 rounded border-violet-300"
                        />
                        <span>
                          Boucles d’affinage (critique CIO puis, si besoin, nouvelle passe équipe + synthèse) — max{" "}
                          {mcRecursive ? (
                            <input
                              type="number"
                              min={1}
                              max={5}
                              value={mcRounds}
                              onChange={(e) => setMcRounds(e.target.value)}
                              disabled={loading}
                              className="w-14 inline-block border border-violet-200 rounded px-1 py-0.5 text-center mx-0.5"
                            />
                          ) : (
                            "0"
                          )}{" "}
                          tour(s)
                        </span>
                      </label>
                      <label className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={mcRequireValidation}
                          onChange={(e) => setMcRequireValidation(e.target.checked)}
                          disabled={loading}
                          className="mt-0.5 rounded border-violet-300"
                        />
                        <span>Exiger ma validation en fin de mission (sinon auto-clôture pour enchaîner).</span>
                      </label>
                    </div>
                    <label className="block text-xs text-slate-600">
                      Consigne finale (optionnel — sinon synthèse auto à partir de la conversation)
                    </label>
                    <textarea
                      rows={3}
                      value={briefOverride}
                      onChange={(e) => setBriefOverride(e.target.value)}
                      disabled={loading}
                      className="w-full border border-violet-200 rounded-xl px-3 py-2 text-sm bg-white"
                      placeholder="Colle ici la consigne exacte à exécuter si tu veux forcer le texte."
                    />
                    {agent === "coordinateur" ? (
                      <p className="text-[11px] text-slate-500 leading-relaxed mt-1">
                        Avec le <strong>CIO</strong>, la conversation de cadrage est <strong>toujours jointe</strong> à
                        cette consigne à l’exécution (même si tu la raccourcis ici), pour que les mentions de rôles
                        (commercial, dev, etc.) restent visibles du moteur de plan.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={validateAndRun}
                      disabled={loading}
                      className="w-full sm:w-auto bg-violet-900 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-violet-800 disabled:opacity-40 cursor-pointer"
                    >
                      Valider et lancer l’exécution
                    </button>
                  </div>
                </>
              ) : (
                <p className="p-4 text-sm text-slate-500 border-t border-slate-100">
                  Session clôturée. Crée une nouvelle session pour un autre cadrage.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
