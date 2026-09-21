"use client";

import { FormEvent, useState } from "react";

type Props = {
  teamLabel: string;
  busy?: boolean;
  onLaunch: (mission: string) => Promise<void> | void;
};

export default function MapColumnLaunch({ teamLabel, busy, onLaunch }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const mission = text.trim();
    if (mission.length < 8) {
      setError("Décrivez l’objectif en une phrase (8 caractères min.).");
      return;
    }
    setError("");
    try {
      await onLaunch(mission);
      setText("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Lancement impossible.");
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        className="mt-1 w-full rounded-xl border border-dashed border-sky-300 bg-white/70 px-3 py-2.5 text-sm font-bold text-sky-900 hover:bg-white"
        onClick={() => setOpen(true)}
      >
        + Nouvelle mission
      </button>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mt-1 space-y-2 rounded-xl border border-sky-200 bg-white p-2.5">
      <label className="block">
        <span className="text-[10px] font-bold uppercase tracking-wide text-sky-800">Mission · {teamLabel}</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          placeholder="Objectif, en une phrase claire…"
          className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-2 text-sm text-slate-800 outline-none ring-sky-200 placeholder:text-slate-400 focus:ring-2"
        />
      </label>
      {error ? <p className="text-xs font-semibold text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="btn-primary flex-1 text-xs">
          {busy ? "Lancement…" : "Lancer"}
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={() => setOpen(false)} disabled={busy}>
          Annuler
        </button>
      </div>
    </form>
  );
}
