"use client";

import { useEffect, useState } from "react";
import {
  REFLECTION_TIER_META,
  buildReflectionTiersJson,
  defaultMistralTiersJson,
  parseReflectionTiersJson,
  type ReflectionTierRow,
} from "../../lib/mistralReflectionTiers";

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-mono text-slate-900 shadow-sm focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/10";

type Props = {
  tiersJson: string;
  onChange: (nextJson: string) => void;
};

export default function MistralReflectionTiersEditor({ tiersJson, onChange }: Props) {
  const [rows, setRows] = useState<ReflectionTierRow[]>(() => parseReflectionTiersJson(tiersJson));

  useEffect(() => {
    setRows(parseReflectionTiersJson(tiersJson));
  }, [tiersJson]);

  const updateRow = (key: ReflectionTierRow["key"], patch: Partial<ReflectionTierRow>) => {
    const next = rows.map((r) => (r.key === key ? { ...r, ...patch } : r));
    setRows(next);
    onChange(buildReflectionTiersJson(next));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Niveaux de réflexion Mistral</h3>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            Chaque palier correspond à un modèle Mistral. Les missions utilisent automatiquement le niveau adapté
            (courant pour le volume, expert pour le CIO et les arbitrages).
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            const json = defaultMistralTiersJson();
            setRows(parseReflectionTiersJson(json));
            onChange(json);
          }}
          className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-900 hover:bg-violet-100"
        >
          Réinitialiser les paliers recommandés
        </button>
      </div>

      <div className="space-y-3">
        {rows.map((row) => (
          <div key={row.key} className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-orange-900">
                {row.label}
              </span>
              <span className="text-xs text-slate-500">{row.hint}</span>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Modèle Mistral
                </label>
                <input
                  type="text"
                  value={row.model}
                  onChange={(e) => updateRow(row.key, { model: e.target.value })}
                  placeholder={REFLECTION_TIER_META[row.key].defaultModel}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  USD / M in
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.priceIn}
                  onChange={(e) => updateRow(row.key, { priceIn: e.target.value })}
                  className={`${inputClass} tabular-nums`}
                />
              </div>
              <div>
                <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  USD / M out
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={row.priceOut}
                  onChange={(e) => updateRow(row.key, { priceOut: e.target.value })}
                  className={`${inputClass} tabular-nums`}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
