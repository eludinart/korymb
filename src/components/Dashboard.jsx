import React, { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_AI_BACKEND_URL || "http://localhost:8000";
const SECRET = import.meta.env.VITE_AGENT_SECRET || "";

function authHeaders() {
  return { "Content-Type": "application/json", "X-Agent-Secret": SECRET };
}

// ── Statut de connexion au backend ──────────────────────────────────────────
function StatusBadge({ status }) {
  const colors = { ok: "#16a34a", error: "#dc2626", loading: "#d97706" };
  const labels = { ok: "Backend connecté", error: "Backend inaccessible", loading: "Vérification…" };
  return (
    <span style={{ ...s.badge, background: colors[status] }}>
      {labels[status]}
    </span>
  );
}

// ── Carte job individuelle ──────────────────────────────────────────────────
function JobCard({ job, onRefresh }) {
  const statusColor = {
    running: "#d97706",
    completed: "#16a34a",
  };
  const isError = job.status.startsWith("error");
  const color = isError ? "#dc2626" : (statusColor[job.status] || "#6b7280");

  return (
    <div style={s.jobCard}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <code style={{ fontSize: 13 }}>#{job.id}</code>
        <span style={{ ...s.badge, background: color }}>{job.status}</span>
      </div>
      <p style={{ margin: "6px 0 0", fontSize: 13, color: "#374151" }}>{job.mission}</p>
      {job.status === "running" && (
        <button style={s.btnSmall} onClick={() => onRefresh(job.id)}>
          Actualiser
        </button>
      )}
    </div>
  );
}

// ── Composant principal ─────────────────────────────────────────────────────
export default function Dashboard() {
  const [backendStatus, setBackendStatus] = useState("loading");
  const [mission, setMission] = useState("");
  const [context, setContext] = useState("");
  const [jobs, setJobs] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  // Ping le backend
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/health`);
      setBackendStatus(res.ok ? "ok" : "error");
    } catch {
      setBackendStatus("error");
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // Actualiser le statut d'un job
  const refreshJob = useCallback(async (jobId) => {
    try {
      const res = await fetch(`${API}/jobs/${jobId}`, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      setJobs((prev) =>
        prev.map((j) => (j.id === jobId ? { ...j, status: data.status } : j))
      );
    } catch {
      // silencieux
    }
  }, []);

  // Lancer une mission
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!mission.trim()) return;
    setError("");
    setSending(true);

    let parsedContext = null;
    if (context.trim()) {
      try {
        parsedContext = JSON.parse(context);
      } catch {
        setError("Le contexte doit être un JSON valide (ou laisser vide).");
        setSending(false);
        return;
      }
    }

    try {
      const res = await fetch(`${API}/run-crew`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ mission: mission.trim(), context: parsedContext }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || `Erreur ${res.status}`);
      }
      const data = await res.json();
      setJobs((prev) => [
        { id: data.job_id, status: data.status === "accepted" ? "running" : data.status, mission: mission.trim() },
        ...prev,
      ]);
      setMission("");
      setContext("");
    } catch (err) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={s.page}>
      {/* En-tête */}
      <div style={s.header}>
        <h2 style={s.title}>Centre de pilotage</h2>
        <StatusBadge status={backendStatus} />
      </div>

      {/* Lancer une mission */}
      <section style={s.card}>
        <h3 style={s.sectionTitle}>Nouvelle mission</h3>
        <form onSubmit={handleSubmit}>
          <label style={s.label}>Mission (langage naturel)</label>
          <textarea
            style={s.textarea}
            rows={3}
            placeholder="Ex : Trouver 3 coachs en développement personnel actifs sur LinkedIn ce mois-ci et préparer une approche maïeutique."
            value={mission}
            onChange={(e) => setMission(e.target.value)}
            disabled={sending}
          />
          <label style={s.label}>Contexte additionnel (JSON, optionnel)</label>
          <textarea
            style={{ ...s.textarea, fontFamily: "monospace", fontSize: 12 }}
            rows={2}
            placeholder='{"segment": "coachs", "deadline": "2026-04-25"}'
            value={context}
            onChange={(e) => setContext(e.target.value)}
            disabled={sending}
          />
          {error && <p style={s.error}>{error}</p>}
          <button
            type="submit"
            style={{ ...s.btn, opacity: sending || backendStatus !== "ok" ? 0.5 : 1 }}
            disabled={sending || backendStatus !== "ok"}
          >
            {sending ? "Envoi en cours…" : "Lancer la mission"}
          </button>
        </form>
      </section>

      {/* Jobs en cours / terminés */}
      <section style={s.card}>
        <h3 style={s.sectionTitle}>Missions ({jobs.length})</h3>
        {jobs.length === 0 ? (
          <p style={{ color: "#6b7280", fontSize: 14 }}>Aucune mission lancée pour l'instant.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} onRefresh={refreshJob} />
            ))}
          </div>
        )}
      </section>

      {/* Infos de configuration */}
      <section style={s.card}>
        <h3 style={s.sectionTitle}>Configuration</h3>
        <table style={s.table}>
          <tbody>
            <tr>
              <td style={s.tdLabel}>Backend URL</td>
              <td><code style={s.code}>{API}</code></td>
            </tr>
            <tr>
              <td style={s.tdLabel}>Secret configuré</td>
              <td><code style={s.code}>{SECRET ? "✓ oui" : "✗ manquant"}</code></td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const s = {
  page: { display: "flex", flexDirection: "column", gap: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  title: { margin: 0, fontSize: 20 },
  card: {
    border: "1px solid #e5e7eb",
    borderRadius: 10,
    padding: "16px 18px",
    background: "#fff",
  },
  sectionTitle: { margin: "0 0 12px", fontSize: 15, fontWeight: 600 },
  label: { display: "block", fontSize: 13, color: "#374151", marginBottom: 4 },
  textarea: {
    width: "100%",
    boxSizing: "border-box",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 14,
    resize: "vertical",
    marginBottom: 10,
    fontFamily: "inherit",
  },
  btn: {
    background: "#111",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "9px 18px",
    fontSize: 14,
    cursor: "pointer",
  },
  btnSmall: {
    marginTop: 6,
    background: "transparent",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
  badge: {
    color: "#fff",
    borderRadius: 999,
    padding: "3px 10px",
    fontSize: 12,
    fontWeight: 600,
  },
  jobCard: {
    border: "1px solid #e5e7eb",
    borderRadius: 8,
    padding: "10px 12px",
    background: "#f9fafb",
  },
  error: { color: "#dc2626", fontSize: 13, margin: "0 0 10px" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  tdLabel: { color: "#6b7280", paddingRight: 16, paddingBottom: 6, whiteSpace: "nowrap" },
  code: { background: "#f3f4f6", borderRadius: 4, padding: "2px 6px", fontSize: 12 },
};
