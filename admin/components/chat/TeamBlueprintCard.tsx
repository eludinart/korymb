"use client";

import { useLockedAction } from "../../lib/useLockedAction";
import { requestJson } from "../../lib/api";

export type BlueprintOutcome = {
  status: "created" | "rejected";
  label?: string;
};

type Props = {
  blueprintId: string;
  /** Si déjà résolu (persistant sur le message). */
  initialOutcome?: BlueprintOutcome | null;
  onCreated?: (groupId: string, label: string) => void;
  onSettled?: (outcome: BlueprintOutcome) => void;
};

function OutcomeBanner({ outcome }: { outcome: BlueprintOutcome }) {
  const ok = outcome.status === "created";
  const msg = ok
    ? `Équipe « ${outcome.label || "créée"} » créée. Tu peux la sélectionner dans le sélecteur d’interlocuteur.`
    : "Proposition d’équipe refusée.";
  return (
    <div
      className={`mt-3 rounded-2xl border-2 px-4 py-3 text-sm ${
        ok ? "border-emerald-200 bg-emerald-50 text-emerald-950" : "border-slate-200 bg-slate-50 text-slate-700"
      }`}
    >
      {msg}
    </div>
  );
}

export default function TeamBlueprintCard({
  blueprintId,
  initialOutcome = null,
  onCreated,
  onSettled,
}: Props) {
  const lock = useLockedAction();

  if (initialOutcome) {
    return <OutcomeBanner outcome={initialOutcome} />;
  }

  if (lock.isDone) {
    // Sécurité si onSettled n’a pas encore patché le message
    return (
      <div className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        {lock.doneMessage || "Action effectuée."}
      </div>
    );
  }

  const confirm = () =>
    void lock.run(async () => {
      const { data, res } = await requestJson(
        `/team-blueprints/${encodeURIComponent(blueprintId)}/confirm`,
        { method: "POST", expectOk: false },
      );
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
      const gid = String(data?.group?.id || "");
      const label = String(data?.group?.label || "Équipe");
      if (gid) onCreated?.(gid, label);
      onSettled?.({ status: "created", label });
    }, { doneMessage: "Équipe créée." });

  const reject = () =>
    void lock.run(async () => {
      const { res, data } = await requestJson(
        `/team-blueprints/${encodeURIComponent(blueprintId)}/reject`,
        { method: "POST", expectOk: false },
      );
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
      onSettled?.({ status: "rejected" });
    }, { doneMessage: "Proposition d’équipe refusée." });

  return (
    <div className="mt-3 rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-3">
      <p className="text-sm font-semibold text-violet-950">Créer l’équipe proposée ?</p>
      <p className="mt-1 font-mono text-xs text-violet-700">{blueprintId}</p>
      {lock.error ? <p className="mt-2 text-sm text-red-700">{lock.error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={lock.busy}
          aria-busy={lock.busy}
          onClick={confirm}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {lock.busy ? "Traitement…" : "Créer l’équipe"}
        </button>
        <button
          type="button"
          disabled={lock.busy}
          aria-busy={lock.busy}
          onClick={reject}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Refuser
        </button>
      </div>
    </div>
  );
}
