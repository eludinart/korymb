"use client";

import { FormEvent, useEffect, useState } from "react";

type Settings = Record<string, string | number | boolean | undefined>;

export default function KorymbLlmAdminPage() {
  const [data, setData] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setErr("");
    setOk("");
    setLoading(true);
    try {
      const r = await fetch("/api/korymb-admin", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setData(null);
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | number> = {};
    const prov = String(fd.get("llm_provider") || "").trim();
    if (prov) body.llm_provider = prov;
    const fields = [
      "anthropic_model",
      "openrouter_model",
      "openrouter_base_url",
      "openrouter_http_referer",
      "openrouter_app_title",
      "anthropic_api_key",
      "openrouter_api_key",
    ] as const;
    for (const f of fields) {
      const v = String(fd.get(f) || "").trim();
      if (v) body[f] = v;
    }
    const pin = String(fd.get("llm_price_input_per_million_usd") || "").trim();
    const pout = String(fd.get("llm_price_output_per_million_usd") || "").trim();
    if (pin) body.llm_price_input_per_million_usd = parseFloat(pin);
    if (pout) body.llm_price_output_per_million_usd = parseFloat(pout);
    try {
      const r = await fetch("/api/korymb-admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j) || `HTTP ${r.status}`);
      setData(j);
      setOk("Configuration enregistrée (fichier runtime côté serveur).");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <p className="p-8 text-slate-600">Chargement…</p>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold tracking-tight">Administration Korymb — LLM</h1>
      <p className="text-sm text-slate-500 mt-2">
        Les valeurs sont fusionnées avec le <code className="bg-slate-200 px-1 rounded">.env</code> du backend
        et persistées dans <code className="bg-slate-200 px-1 rounded">backend/data/runtime_settings.json</code>.
        Laisse les champs clé API vides pour ne pas les modifier.
      </p>

      {err && (
        <p className="mt-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>
      )}
      {ok && (
        <p className="mt-4 text-sm text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
          {ok}
        </p>
      )}

      {data && (
        <form onSubmit={onSubmit} className="mt-8 space-y-6 bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 block">
              Fournisseur
            </legend>
            <label className="block text-sm font-medium text-slate-700 mb-1">LLM_PROVIDER</label>
            <select
              name="llm_provider"
              defaultValue={String(data.llm_provider || "anthropic")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="anthropic">anthropic</option>
              <option value="openrouter">openrouter</option>
            </select>
          </fieldset>

          <fieldset className="border-t border-slate-100 pt-6">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 block">
              Anthropic
            </legend>
            <label className="block text-sm font-medium text-slate-700 mb-1">ANTHROPIC_MODEL</label>
            <input
              name="anthropic_model"
              type="text"
              defaultValue={String(data.anthropic_model ?? "")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">
              ANTHROPIC_API_KEY {data.anthropic_api_key_set ? "(déjà configurée — saisir pour remplacer)" : ""}
            </label>
            <input
              name="anthropic_api_key"
              type="password"
              autoComplete="off"
              placeholder={data.anthropic_api_key_set ? "••••••••" : "sk-ant-…"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </fieldset>

          <fieldset className="border-t border-slate-100 pt-6">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 block">
              OpenRouter
            </legend>
            <label className="block text-sm font-medium text-slate-700 mb-1">OPENROUTER_MODEL</label>
            <input
              name="openrouter_model"
              type="text"
              defaultValue={String(data.openrouter_model ?? "")}
              placeholder="openai/gpt-4o-mini"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">OPENROUTER_BASE_URL</label>
            <input
              name="openrouter_base_url"
              type="url"
              defaultValue={String(data.openrouter_base_url ?? "")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">OPENROUTER_HTTP_REFERER</label>
            <input
              name="openrouter_http_referer"
              type="url"
              defaultValue={String(data.openrouter_http_referer ?? "")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">OPENROUTER_TITLE</label>
            <input
              name="openrouter_app_title"
              type="text"
              defaultValue={String(data.openrouter_app_title ?? "")}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
            />
            <label className="block text-sm font-medium text-slate-700 mt-4 mb-1">
              OPENROUTER_API_KEY {data.openrouter_api_key_set ? "(déjà configurée)" : ""}
            </label>
            <input
              name="openrouter_api_key"
              type="password"
              autoComplete="off"
              placeholder={data.openrouter_api_key_set ? "••••••••" : "sk-or-…"}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </fieldset>

          <fieldset className="border-t border-slate-100 pt-6">
            <legend className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3 block">
              Estimation coût (USD / million de tokens)
            </legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Entrée</label>
                <input
                  name="llm_price_input_per_million_usd"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={String(data.llm_price_input_per_million_usd ?? "")}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Sortie</label>
                <input
                  name="llm_price_output_per_million_usd"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={String(data.llm_price_output_per_million_usd ?? "")}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-3 pt-4 border-t border-slate-100">
            <button
              type="submit"
              className="bg-slate-900 text-white text-sm font-medium px-6 py-2.5 rounded-xl hover:bg-slate-800"
            >
              Enregistrer
            </button>
            <button type="button" onClick={() => load()} className="text-sm text-slate-600 underline">
              Recharger
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
