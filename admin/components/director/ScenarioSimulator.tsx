"use client";

import { FormEvent, useEffect, useState } from "react";
import { agentHeaders, requestJson } from "../../lib/api";
import { loadThinkingMode } from "../../lib/thinkingMode";
import ThinkingModePicker from "./ThinkingModePicker";

type Horizon = {
  id?: string;
  label?: string;
  narrative?: string;
  opportunities?: string[];
  risks?: string[];
  probability_hint?: string;
};

type SimResult = {
  question?: string;
  summary?: string;
  horizons?: Horizon[];
  source?: string;
};

type Props = {
  className?: string;
};

export default function ScenarioSimulator({ className = "" }: Props) {
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState<SimResult | null>(null);

  useEffect(() => {
    // ancre #scenarios depuis le switcher
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q.length < 8 || busy) return;
    setBusy(true);
    setErr("");
    try {
      const { data } = await requestJson("/admin/scenarios/simulate", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({
          question: q,
          thinking_mode: loadThinkingMode(),
        }),
        timeoutMs: 60_000,
      });
      setResult(data as SimResult);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : String(ex));
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      id="scenarios"
      className={`scroll-mt-24 rounded-2xl border border-indigo-200 bg-gradient-to-b from-indigo-50/70 to-white p-4 shadow-sm ${className}`}
    >
      <p className="text-xs font-extrabold uppercase tracking-wider text-indigo-700">Et si…</p>
      <h3 className="mt-1 text-base font-extrabold text-slate-900">Scénarios à 1 / 5 / 10 ans</h3>
      <p className="mt-1 text-sm text-slate-600">
        Une intention, trois horizons. Indicatif — pas une prédiction chiffrée.
      </p>

      <form onSubmit={(e) => void onSubmit(e)} className="mt-3 space-y-2">
        <ThinkingModePicker persist compact className="mb-1" />
        <label htmlFor="scenario-q" className="sr-only">
          Question de scénario
        </label>
        <textarea
          id="scenario-q"
          rows={2}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          disabled={busy}
          className="field-input leading-relaxed"
          placeholder="Ex. : Si j’accepte ce projet à Berlin, qu’est-ce qui change pour mon activité ?"
        />
        <button type="submit" disabled={busy || question.trim().length < 8} className="btn-primary">
          {busy ? "Simulation…" : "Simuler"}
        </button>
      </form>

      {err ? (
        <p className="mt-2 text-sm font-semibold text-red-700" role="alert">
          {err}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          {result.summary ? <p className="text-sm font-semibold text-slate-800">{result.summary}</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            {(result.horizons || []).map((h) => (
              <article
                key={h.id || h.label}
                className="rounded-xl border border-indigo-100 bg-white p-3 shadow-sm"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-indigo-800">
                  {h.label || h.id}
                  {h.probability_hint ? (
                    <span className="ml-1 font-medium text-slate-500">· {h.probability_hint}</span>
                  ) : null}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-700">{h.narrative}</p>
                {(h.opportunities || []).length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-emerald-800">
                    {(h.opportunities || []).map((o) => (
                      <li key={o}>+ {o}</li>
                    ))}
                  </ul>
                ) : null}
                {(h.risks || []).length > 0 ? (
                  <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
                    {(h.risks || []).map((r) => (
                      <li key={r}>! {r}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ))}
          </div>
          {result.source === "heuristic" ? (
            <p className="text-[11px] text-slate-500">Mode repli (sans LLM) — esquisse indicative.</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
