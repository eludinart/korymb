"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import AgentMessageMarkdown from "./AgentMessageMarkdown";
import { agentHeaders, requestJson } from "../lib/api";
import { normalizeTeamRows } from "../lib/jobTeam";
import {
  deliverablesForMissionPanel,
  matchDeliverableTitleToAgentKey,
  type ParsedDeliverable,
} from "../lib/extractTeamDeliverables";
import type { TeamRow } from "../lib/types";

function slugKeyFn(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9_]/g, "")
      .slice(0, 48) || "livrable"
  );
}

type AgentUi = { director_note_markdown?: string; accepted_at?: string | null };

type Props = {
  jobId: string;
  resultMarkdown: string;
  team: unknown;
  deliverablesUi: { agents?: Record<string, AgentUi> } | null | undefined;
  missionClosed: boolean;
  canValidateMission: boolean;
  validateBusy?: boolean;
  onValidateMission?: () => void | Promise<void>;
  onSaved?: () => void;
  className?: string;
};

function downloadMarkdown(filename: string, body: string) {
  const blob = new Blob([body], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function MissionDeliverablesPanel({
  jobId,
  resultMarkdown,
  team,
  deliverablesUi,
  missionClosed,
  canValidateMission,
  validateBusy = false,
  onValidateMission,
  onSaved,
  className = "",
}: Props) {
  const rows = useMemo(() => normalizeTeamRows(team), [team]);
  const items = useMemo(() => deliverablesForMissionPanel(resultMarkdown, rows), [resultMarkdown, rows]);
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");

  const agentsUi = deliverablesUi?.agents && typeof deliverablesUi.agents === "object" ? deliverablesUi.agents : {};

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const it of items) {
      const key = matchDeliverableTitleToAgentKey(it.title, rows) || slugKeyFn(it.title);
      const prev = deliverablesUi?.agents?.[key]?.director_note_markdown;
      if (typeof prev === "string") next[key] = prev;
    }
    setLocalNotes(next);
  }, [jobId, items, rows, deliverablesUi]);

  const resolveKey = useCallback(
    (it: ParsedDeliverable) => matchDeliverableTitleToAgentKey(it.title, rows) || slugKeyFn(it.title),
    [rows],
  );

  const saveNote = async (agentKey: string) => {
    setBusyKey(agentKey);
    setFeedback("");
    try {
      await requestJson(`/jobs/${encodeURIComponent(jobId)}/deliverables-ui`, {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({
          agents: { [agentKey]: { director_note_markdown: localNotes[agentKey] ?? "" } },
        }),
      });
      setFeedback("Notes enregistrées.");
      onSaved?.();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const setAccepted = async (agentKey: string, accepted: boolean) => {
    setBusyKey(agentKey);
    setFeedback("");
    try {
      await requestJson(`/jobs/${encodeURIComponent(jobId)}/deliverables-ui`, {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({
          agents: { [agentKey]: { accepted_at: accepted ? new Date().toISOString() : null } },
        }),
      });
      setFeedback(accepted ? "Livrable marqué comme accepté." : "Acceptation retirée.");
      onSaved?.();
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyKey(null);
    }
  };

  const copyBody = async (body: string) => {
    try {
      await navigator.clipboard.writeText(body);
      setFeedback("Copié dans le presse-papiers.");
    } catch {
      setFeedback("Copie impossible (navigateur).");
    }
  };

  const mailtoSend = (title: string, body: string) => {
    const sub = encodeURIComponent(`Korymb — livrable : ${title} (#${jobId})`);
    const lines = body.length > 6000 ? `${body.slice(0, 6000)}\n\n[… texte tronqué pour l’email — copiez le .md exporté pour le contenu complet]` : body;
    const bodyEnc = encodeURIComponent(lines);
    window.open(`mailto:?subject=${sub}&body=${bodyEnc}`, "_blank");
  };

  if (!items.length) return null;

  return (
    <section
      className={`rounded-2xl border border-emerald-200/90 bg-gradient-to-b from-emerald-50/80 to-white shadow-sm ${className}`}
      aria-label="Livrables de mission"
    >
      <header className="border-b border-emerald-100 px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wide text-emerald-900">Livrables</p>
        <p className="mt-1 text-xs leading-relaxed text-emerald-900/80">
          Consultez chaque livrable, ajoutez vos notes ou corrections, marquez votre acceptation, exportez en Markdown ou
          ouvrez un brouillon d&apos;email. La validation globale de la mission reste le bouton « Valider » dans la liste.
        </p>
        {feedback ? <p className="mt-2 text-[11px] text-emerald-800">{feedback}</p> : null}
      </header>
      <div className="space-y-4 px-4 py-4">
        {items.map((it, idx) => {
          const agentKey = resolveKey(it);
          const ui = agentsUi[agentKey] || {};
          const accepted = Boolean(ui.accepted_at);
          const fname = `livrable-${jobId}-${agentKey || idx}.md`;
          return (
            <article
              key={`${agentKey}-${idx}`}
              className="rounded-xl border border-emerald-100 bg-white/95 p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-2">
                <h3 className="text-sm font-semibold text-slate-900">{it.title}</h3>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => void copyBody(it.body)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Copier
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadMarkdown(fname, it.body)}
                    className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Télécharger .md
                  </button>
                  <button
                    type="button"
                    onClick={() => mailtoSend(it.title, it.body)}
                    className="rounded-lg border border-violet-200 bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-900 hover:bg-violet-100"
                  >
                    Brouillon email
                  </button>
                </div>
              </div>
              <div className="mt-3 max-h-[min(28rem,52vh)] min-h-0 overflow-y-auto rounded-lg border border-slate-100 bg-slate-50/60 px-3 py-2">
                <AgentMessageMarkdown
                  source={it.body}
                  className="text-[12px] leading-relaxed text-slate-800 [&_li]:text-[12px] [&_ol]:my-1 [&_p]:text-[12px] [&_ul]:my-1"
                />
              </div>
              {!missionClosed ? (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-3">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Votre note / modification (Markdown)
                    </p>
                    <textarea
                      value={localNotes[agentKey] ?? ""}
                      onChange={(e) => setLocalNotes((s) => ({ ...s, [agentKey]: e.target.value }))}
                      rows={4}
                      className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 font-mono text-[11px] text-slate-800"
                      placeholder="Ex. : demande de précision, reformulation, validation partielle…"
                    />
                    <button
                      type="button"
                      disabled={busyKey === agentKey}
                      onClick={() => void saveNote(agentKey)}
                      className="mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
                    >
                      {busyKey === agentKey ? "Enregistrement…" : "Enregistrer la note"}
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-700">
                    <input
                      type="checkbox"
                      checked={accepted}
                      disabled={busyKey === agentKey}
                      onChange={(e) => void setAccepted(agentKey, e.target.checked)}
                      className="rounded border-slate-300"
                    />
                    <span>J&apos;accepte ce livrable (suivi interne)</span>
                  </label>
                  {accepted && ui.accepted_at ? (
                    <p className="text-[10px] text-slate-500">Accepté le {new Date(ui.accepted_at).toLocaleString("fr-FR")}</p>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-[11px] text-slate-500">Mission clôturée — notes et acceptations en lecture seule.</p>
              )}
            </article>
          );
        })}
      </div>
      {canValidateMission && onValidateMission ? (
        <footer className="border-t border-emerald-100 px-4 py-3">
          <button
            type="button"
            disabled={validateBusy}
            onClick={() => void onValidateMission()}
            className="rounded-xl bg-violet-900 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-950 disabled:opacity-40"
          >
            {validateBusy ? "Validation…" : "Valider la mission (clôture dirigeant)"}
          </button>
          <p className="mt-2 text-[10px] text-slate-500">
            Ce bouton enregistre la validation globale de la mission (distincte de l&apos;acceptation par livrable ci-dessus).
          </p>
        </footer>
      ) : null}
    </section>
  );
}
