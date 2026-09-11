"use client";

import { useState } from "react";
import { requestJson } from "../../lib/api";

type Props = {
  blueprintId: string;
  onCreated?: (groupId: string) => void;
  onDismiss?: () => void;
};

export default function TeamBlueprintCard({ blueprintId, onCreated, onDismiss }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState<{ groupId: string; label: string } | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const { data, res } = await requestJson(`/team-blueprints/${encodeURIComponent(blueprintId)}/confirm`, {
        method: "POST",
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
      const gid = String(data?.group?.id || "");
      const label = String(data?.group?.label || "Équipe");
      setDone({ groupId: gid, label });
      if (gid) onCreated?.(gid);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reject = async () => {
    setBusy(true);
    setError("");
    try {
      await requestJson(`/team-blueprints/${encodeURIComponent(blueprintId)}/reject`, { method: "POST" });
      onDismiss?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="mt-3 rounded-2xl border-2 border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950">
        Équipe <strong>{done.label}</strong> créée. Tu peux la sélectionner dans le sélecteur d’interlocuteur.
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl border-2 border-violet-200 bg-violet-50 px-4 py-3">
      <p className="text-sm font-semibold text-violet-950">Créer l’équipe proposée ?</p>
      <p className="mt-1 font-mono text-xs text-violet-700">{blueprintId}</p>
      {error ? <p className="mt-2 text-sm text-red-700">{error}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void confirm()}
          className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
        >
          {busy ? "Création…" : "Créer l’équipe"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void reject()}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          Refuser
        </button>
      </div>
    </div>
  );
}
