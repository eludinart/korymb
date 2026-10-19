"use client";

import { useState } from "react";
import { agentHeaders, requestJson } from "../../lib/api";

type Citation = {
  span_id?: string;
  kind?: string;
  agent?: string;
  excerpt?: string;
};

const KIND_LABEL: Record<string, string> = {
  llm: "Modèle",
  tool: "Outil",
  tool_replay: "Déjà fait",
  tool_error: "Outil",
  hitl: "Validation",
  mission_start: "Départ",
  mission_done: "Fin",
  reprise: "Reprise",
  repli: "Ancien chemin",
};

export default function ChatSourceNote({ jobId }: { jobId: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [rows, setRows] = useState<Citation[]>([]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (status === "ready" || status === "loading") return;
    setStatus("loading");
    try {
      const { data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/traces?limit=4`, {
        headers: agentHeaders(),
        retries: 0,
        timeoutMs: 12_000,
      });
      const traces = ((data as { traces?: Array<{ citation?: Citation }> })?.traces || []) as Array<{
        citation?: Citation;
      }>;
      setRows(
        traces
          .map((row) => row.citation)
          .filter((item): item is Citation => Boolean(item && (item.excerpt || item.kind))),
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => void toggle()}
        className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300"
      >
        {open ? "Fermer les sources" : "D'où ça vient"}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800">
          {status === "loading" ? <p className="text-xs text-slate-500">Lecture des sources…</p> : null}
          {status === "error" ? (
            <p className="text-xs text-rose-700">Les sources ne se sont pas ouvertes. Réessayez.</p>
          ) : null}
          {status === "ready" && rows.length === 0 ? (
            <p className="text-xs text-slate-500">Pas encore de source pour cette réponse.</p>
          ) : null}
          {status === "ready"
            ? rows.map((row) => (
                <p key={row.span_id || `${row.kind}-${row.excerpt}`} className="text-xs text-slate-700 dark:text-slate-200">
                  <span className="font-bold">{KIND_LABEL[row.kind || ""] || "Note"}</span>
                  {row.agent ? <span className="text-slate-500"> · {row.agent}</span> : null}
                  {row.excerpt ? <span> — {row.excerpt}</span> : null}
                </p>
              ))
            : null}
        </div>
      ) : null}
    </div>
  );
}
