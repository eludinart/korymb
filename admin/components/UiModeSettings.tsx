"use client";

import { useUiMode, type UiMode } from "../lib/uiMode";

export default function UiModeSettings({ compact = false }: { compact?: boolean }) {
  const { uiMode, setUiMode, busy, error, loading } = useUiMode();

  async function choose(mode: UiMode) {
    if (mode === uiMode || busy) return;
    try {
      await setUiMode(mode);
    } catch {
      /* error state already set */
    }
  }

  if (loading) {
    return <p className="text-sm text-slate-500">Chargement du mode d&apos;interface…</p>;
  }

  return (
    <section
      className={
        compact
          ? "rounded-xl border border-slate-200 bg-white p-3"
          : "rounded-2xl border border-violet-100 bg-violet-50/40 p-4 sm:p-5"
      }
    >
      <h2 className="text-sm font-extrabold text-slate-900">Mode d&apos;interface</h2>
      <p className="mt-1 text-xs text-slate-600">
        Essentiel simplifie navigation et accueil. Avancé montre tout le cockpit (Carte, Studio, audit…).
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void choose("essential")}
          className={`rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60 ${
            uiMode === "essential"
              ? "bg-violet-700 text-white"
              : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
          }`}
        >
          Essentiel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void choose("advanced")}
          className={`rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60 ${
            uiMode === "advanced"
              ? "bg-violet-700 text-white"
              : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
          }`}
        >
          Avancé
        </button>
        {busy ? <span className="self-center text-xs text-slate-500">Enregistrement…</span> : null}
      </div>
      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}
    </section>
  );
}
