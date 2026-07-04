"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  buildMissionHistoryEntries,
  historyTypeLabel,
  type HistoryEntry,
  type HistoryItemType,
} from "../../lib/historyEntries";
import { deleteMissionJob } from "../../lib/deleteMissionJob";
import { deleteMissionSession } from "../../lib/deleteMissionSession";

import type { Job } from "../../lib/types";

type MissionSessionRow = {
  id: string;
  title?: string;
  agent?: string;
  status?: string;
  linked_job_id?: string;
  updated_at?: string;
  created_at?: string;
};

type FilterKind = "all" | "mission" | "guidee";

type SelectKey = `job:${string}` | `session:${string}`;

type Props = {
  jobs: Job[];
  sessions: MissionSessionRow[];
  loading?: boolean;
  onFeedback: (msg: string) => void;
  onError: (msg: string) => void;
  onChanged: () => void;
};

function formatWhen(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
}

function sessionTitle(s: MissionSessionRow): string {
  const t = String(s.title || "").trim();
  if (t) return t.length > 90 ? `${t.slice(0, 89)}…` : t;
  return `Session ${s.id.slice(0, 8)}`;
}

function matchesSearch(text: string, q: string): boolean {
  if (!q) return true;
  return text.toLowerCase().includes(q.toLowerCase());
}

export default function InteractionHistoryPanel({
  jobs,
  sessions,
  loading = false,
  onFeedback,
  onError,
  onChanged,
}: Props) {
  const [filter, setFilter] = useState<FilterKind>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Record<string, true>>({});
  const [busy, setBusy] = useState(false);

  const jobEntries = useMemo(() => buildMissionHistoryEntries(jobs), [jobs]);

  const filteredJobs = useMemo(() => {
    return jobEntries.filter((e) => {
      if (filter === "mission" && e.type !== "mission") return false;
      if (filter === "guidee" && e.type !== "mission_guidee") return false;
      const blob = `${e.title} ${e.quickInfo} ${e.displayJobId}`;
      return matchesSearch(blob, search.trim());
    });
  }, [jobEntries, filter, search]);

  const filteredSessions = useMemo(() => {
    if (filter === "mission") return [];
    return sessions.filter((s) => {
      const blob = `${sessionTitle(s)} ${s.status || ""} ${s.agent || ""} ${s.id} ${s.linked_job_id || ""}`;
      return matchesSearch(blob, search.trim());
    });
  }, [sessions, filter, search]);

  const visibleKeys = useMemo(() => {
    const keys: SelectKey[] = [];
    for (const e of filteredJobs) keys.push(`job:${e.id}`);
    for (const s of filteredSessions) keys.push(`session:${s.id}`);
    return keys;
  }, [filteredJobs, filteredSessions]);

  const selectedCount = visibleKeys.filter((k) => selected[k]).length;
  const allVisibleSelected = visibleKeys.length > 0 && selectedCount === visibleKeys.length;

  const toggleAll = () => {
    if (allVisibleSelected) {
      setSelected((prev) => {
        const next = { ...prev };
        for (const k of visibleKeys) delete next[k];
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = { ...prev };
      for (const k of visibleKeys) next[k] = true;
      return next;
    });
  };

  const toggleOne = (key: SelectKey) => {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[key]) delete next[key];
      else next[key] = true;
      return next;
    });
  };

  const deleteJobEntry = async (entry: HistoryEntry) => {
    const label =
      entry.type === "mission_guidee"
        ? `la mission guidée « ${entry.title} »`
        : `la mission « ${entry.title} »`;
    if (typeof window !== "undefined" && !window.confirm(`Supprimer ${label} ?`)) return;
    setBusy(true);
    onError("");
    try {
      for (const jobId of entry.jobIds) {
        await deleteMissionJob(jobId);
      }
      setSelected((prev) => {
        const next = { ...prev };
        delete next[`job:${entry.id}`];
        return next;
      });
      onFeedback("Entrée supprimée.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteSessionRow = async (s: MissionSessionRow) => {
    if (
      typeof window !== "undefined" &&
      !window.confirm(
        `Supprimer la session « ${sessionTitle(s)} » ?${
          s.linked_job_id ? " La mission liée (#" + s.linked_job_id + ") restera dans l'historique." : ""
        }`,
      )
    ) {
      return;
    }
    setBusy(true);
    onError("");
    try {
      await deleteMissionSession(s.id);
      setSelected((prev) => {
        const next = { ...prev };
        delete next[`session:${s.id}`];
        return next;
      });
      onFeedback("Session supprimée.");
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteSelected = async () => {
    const keys = visibleKeys.filter((k) => selected[k]);
    if (!keys.length) return;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Supprimer ${keys.length} élément(s) sélectionné(s) ? Cette action est irréversible.`)
    ) {
      return;
    }
    setBusy(true);
    onError("");
    let ok = 0;
    const errors: string[] = [];
    for (const key of keys) {
      try {
        if (key.startsWith("job:")) {
          const entryId = key.slice(4);
          const entry = filteredJobs.find((e) => e.id === entryId);
          if (!entry) continue;
          for (const jobId of entry.jobIds) await deleteMissionJob(jobId);
        } else {
          const sid = key.slice(8);
          await deleteMissionSession(sid);
        }
        ok += 1;
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    setSelected({});
    if (ok) onFeedback(`${ok} élément(s) supprimé(s).`);
    if (errors.length) onError(errors[0]);
    onChanged();
    setBusy(false);
  };

  const typeBadge = (type: HistoryItemType | "session") => {
    if (type === "session") return "Session guidée";
    return historyTypeLabel(type);
  };

  const totalCount = filteredJobs.length + filteredSessions.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex flex-wrap gap-2">
          {(
            [
              ["all", "Tout"],
              ["mission", "Missions"],
              ["guidee", "Guidées"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold transition-colors ${
                filter === id
                  ? "bg-violet-700 text-white"
                  : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher…"
          className="min-w-[12rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-violet-200"
        />
        <p className="text-xs text-slate-500 sm:ml-auto">
          {loading ? "Chargement…" : `${totalCount} entrée(s)`}
        </p>
      </div>

      {selectedCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-sm font-medium text-amber-950">{selectedCount} sélectionné(s)</span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void deleteSelected()}
            className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm font-semibold text-red-800 hover:bg-red-50 disabled:opacity-50"
          >
            Supprimer la sélection
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelected({})}
            className="text-sm font-medium text-amber-900 underline hover:text-amber-950"
          >
            Tout désélectionner
          </button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/80 px-4 py-2.5">
          <label className="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleAll}
              disabled={!visibleKeys.length || busy}
              className="rounded border-slate-300"
            />
            Tout
          </label>
        </div>

        {!loading && totalCount === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">Aucune interaction à afficher.</p>
        ) : null}

        <ul className="divide-y divide-slate-100">
          {filteredJobs.map((entry) => {
            const key: SelectKey = `job:${entry.id}`;
            const job = jobs.find((j) => j.job_id === entry.displayJobId);
            return (
              <li key={entry.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-slate-50/60">
                <input
                  type="checkbox"
                  checked={Boolean(selected[key])}
                  onChange={() => toggleOne(key)}
                  disabled={busy}
                  className="mt-1 rounded border-slate-300"
                  aria-label={`Sélectionner ${entry.title}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                      {typeBadge(entry.type)}
                    </span>
                    <span className="font-mono text-[10px] text-slate-400">#{entry.displayJobId}</span>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{entry.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{entry.quickInfo}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatWhen(job?.created_at)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/missions?job=${encodeURIComponent(entry.displayJobId)}`}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-white"
                  >
                    Consulter
                  </Link>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteJobEntry(entry)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-40"
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}

          {filteredSessions.map((s) => {
            const key: SelectKey = `session:${s.id}`;
            return (
              <li key={s.id} className="flex flex-wrap items-start gap-3 px-4 py-3 hover:bg-slate-50/60">
                <input
                  type="checkbox"
                  checked={Boolean(selected[key])}
                  onChange={() => toggleOne(key)}
                  disabled={busy}
                  className="mt-1 rounded border-slate-300"
                  aria-label={`Sélectionner ${sessionTitle(s)}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-md bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-800">
                      {typeBadge("session")}
                    </span>
                    <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {s.status || "—"}
                    </span>
                    {s.linked_job_id ? (
                      <span className="font-mono text-[10px] text-slate-400">→ job #{s.linked_job_id}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-sm font-semibold text-slate-900">{sessionTitle(s)}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Agent {s.agent || "coordinateur"} · {s.id.slice(0, 12)}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatWhen(s.updated_at || s.created_at)}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Link
                    href={`/missions?mode=guided&session=${encodeURIComponent(s.id)}`}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-white"
                  >
                    Ouvrir
                  </Link>
                  {s.linked_job_id ? (
                    <Link
                      href={`/missions?job=${encodeURIComponent(s.linked_job_id)}`}
                      className="rounded-lg border border-violet-200 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-50"
                    >
                      Mission liée
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void deleteSessionRow(s)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50 disabled:opacity-40"
                  >
                    Supprimer
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
