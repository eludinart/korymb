"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import HealthDot from "../../../components/HealthDot";
import MistralReflectionTiersEditor from "../../../components/config/MistralReflectionTiersEditor";
import type { HealthTone } from "../../../lib/healthTone";
import { DEFAULT_LLM_TIERS_JSON_EXAMPLE } from "../../../lib/defaultLlmTiersExample";
import { defaultMistralTiersJson } from "../../../lib/mistralReflectionTiers";

type LlmProvider = "mistral" | "anthropic" | "openrouter";

type Settings = Record<string, string | number | boolean | undefined>;

type TierRouting = {
  openrouter_fallback_model?: string;
  tiers?: Record<string, { model: string; price_input_per_million_usd?: number; price_output_per_million_usd?: number }>;
  expensive_research_tier?: boolean;
  default_prices?: { input_per_million_usd?: number; output_per_million_usd?: number };
};

type Props = { showLegacyHint?: boolean };

const inputClass =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-4 focus:ring-violet-500/10";

const labelClass = "text-sm font-medium text-slate-800";

/** Hauteur homogène pour select / input / bouton d’action sur la ligne principale. */
const controlH = "min-h-11";

const fieldLabelClass = "mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500";

function modelOptions(raw: unknown): string[] {
  const push = (acc: string[], s: string) => {
    const t = s.trim();
    if (t) acc.push(t);
  };
  const fromObject = (o: Record<string, unknown>): string => {
    for (const k of ["id", "model", "value", "name"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  const fromArray = (arr: unknown[]): string[] => {
    const out: string[] = [];
    for (const el of arr) {
      if (typeof el === "string") push(out, el);
      else if (el && typeof el === "object" && !Array.isArray(el)) {
        const s = fromObject(el as Record<string, unknown>);
        if (s) out.push(s);
      }
    }
    return out;
  };

  if (raw == null) return [];
  if (Array.isArray(raw)) return [...new Set(fromArray(raw))];
  if (typeof raw === "object") {
    const one = fromObject(raw as Record<string, unknown>);
    return one ? [one] : [];
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    const s = String(raw).trim();
    return s ? [s] : [];
  }
  if (typeof raw === "string") {
    return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
  }
  return [];
}

function apiKeyTone(
  configured: boolean,
  kind: LlmProvider,
  activeProvider: string,
): HealthTone {
  if (configured) return "ok";
  const p = activeProvider.toLowerCase();
  if (kind === p) return "warn";
  return "bad";
}

function ApiKeyStatusRow({
  kind,
  label,
  configured,
  activeProvider,
}: {
  kind: LlmProvider;
  label: string;
  configured: boolean;
  activeProvider: string;
}) {
  const tone = apiKeyTone(configured, kind, activeProvider);
  const p = activeProvider.toLowerCase();
  const required = kind === p;
  let caption: string;
  if (configured) caption = "Clé présente côté serveur.";
  else if (required) caption = "Clé manquante — requise pour ce fournisseur.";
  else caption = "Aucune clé enregistrée pour ce fournisseur (non utilisé pour les appels actuels).";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-slate-200/90 bg-white px-4 py-3 shadow-sm">
      <HealthDot tone={tone} size="md" label={caption} className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">{label}</p>
        <p className="mt-0.5 text-xs leading-snug text-slate-500">{caption}</p>
      </div>
    </div>
  );
}

function ActiveProviderBadge({ provider }: { provider: string }) {
  const p = provider.toLowerCase();
  const styles: Record<string, string> = {
    mistral: "bg-orange-50 text-orange-950 ring-orange-100",
    anthropic: "bg-violet-50 text-violet-900 ring-violet-100",
    openrouter: "bg-sky-50 text-sky-900 ring-sky-100",
  };
  const cls = styles[p] || "bg-slate-100 text-slate-800 ring-slate-200";
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ring-1 ${cls}`}>
      Fournisseur actif · {provider}
    </span>
  );
}

function ConfigSkeleton() {
  return (
    <div className="space-y-6 animate-pulse" aria-busy="true" aria-label="Chargement de la configuration">
      <div className="h-8 w-56 rounded-lg bg-slate-200" />
      <div className="h-4 max-w-xl rounded bg-slate-200" />
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="h-24 rounded-xl bg-slate-100" />
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="h-14 rounded-xl bg-slate-100" />
          <div className="h-14 rounded-xl bg-slate-100" />
          <div className="h-14 rounded-xl bg-slate-100" />
        </div>
      </div>
    </div>
  );
}

function syncDraftsFromSettings(d: Settings) {
  return {
    provider: String(d.llm_provider || "mistral"),
    anthropicModel: String(d.anthropic_model ?? ""),
    mistralModel: String(d.mistral_model ?? ""),
    mistralBase: String(d.mistral_base_url ?? ""),
    openrouterModel: String(d.openrouter_model ?? ""),
    openrouterBase: String(d.openrouter_base_url ?? ""),
    openrouterReferer: String(d.openrouter_http_referer ?? ""),
    openrouterTitle: String(d.openrouter_app_title ?? ""),
    priceIn: String(d.llm_price_input_per_million_usd ?? ""),
    priceOut: String(d.llm_price_output_per_million_usd ?? ""),
    tiersJson: String(d.llm_tiers_json ?? ""),
  };
}

export default function KorymbLlmAdminPage({ showLegacyHint = true }: Props) {
  const router = useRouter();
  const [data, setData] = useState<Settings | null>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelQuickBusy, setModelQuickBusy] = useState(false);
  const [tiersDisableBusy, setTiersDisableBusy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [configMode, setConfigMode] = useState<"essential" | "expert">("essential");
  const [tiersDraft, setTiersDraft] = useState("");

  const [providerDraft, setProviderDraft] = useState<LlmProvider>("mistral");
  const [anthropicModel, setAnthropicModel] = useState("");
  const [mistralModel, setMistralModel] = useState("");
  const [mistralBase, setMistralBase] = useState("");
  const [openrouterModel, setOpenrouterModel] = useState("");
  const [openrouterBase, setOpenrouterBase] = useState("");
  const [openrouterReferer, setOpenrouterReferer] = useState("");
  const [openrouterTitle, setOpenrouterTitle] = useState("");
  const [priceIn, setPriceIn] = useState("");
  const [priceOut, setPriceOut] = useState("");

  const anthropicModels = useMemo(() => modelOptions(data?.anthropic_models), [data?.anthropic_models]);
  const mistralModels = useMemo(() => modelOptions(data?.mistral_models), [data?.mistral_models]);
  const openrouterModels = useMemo(() => modelOptions(data?.openrouter_models), [data?.openrouter_models]);

  const tierRouting = (data?.tier_routing || {}) as TierRouting;
  /** Résumé serveur après dernier enregistrement (le brouillon JSON n’est appliqué qu’au save). */
  const savedTiersActive = Boolean(tierRouting.tiers && Object.keys(tierRouting.tiers).length > 0);
  const tiersDraftNonEmpty = Boolean(tiersDraft.trim());
  const tierRoutingRelevant = savedTiersActive || tiersDraftNonEmpty;
  const expertMode = configMode === "expert";

  useEffect(() => {
    if (!data) return;
    const s = syncDraftsFromSettings(data);
    setProviderDraft(s.provider as LlmProvider);
    setAnthropicModel(s.anthropicModel);
    setMistralModel(s.mistralModel);
    setMistralBase(s.mistralBase);
    setOpenrouterModel(s.openrouterModel);
    setOpenrouterBase(s.openrouterBase);
    setOpenrouterReferer(s.openrouterReferer);
    setOpenrouterTitle(s.openrouterTitle);
    setPriceIn(s.priceIn);
    setPriceOut(s.priceOut);
    setTiersDraft(s.tiersJson || (s.provider === "mistral" ? defaultMistralTiersJson() : ""));
  }, [data]);

  async function load(mode: "initial" | "refresh" = "initial") {
    setErr("");
    setOk("");
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);
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
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void load("initial");
  }, []);

  async function saveModelQuick() {
    setErr("");
    setOk("");
    const prov = providerDraft.trim().toLowerCase() as LlmProvider;
    if (prov !== "anthropic" && prov !== "openrouter" && prov !== "mistral") {
      setErr("Fournisseur invalide.");
      return;
    }
    const model =
      prov === "openrouter"
        ? openrouterModel.trim()
        : prov === "mistral"
          ? mistralModel.trim()
          : anthropicModel.trim();
    if (!model) {
      setErr(
        prov === "openrouter"
          ? "Saisis un identifiant modèle OpenRouter (ex. openai/gpt-4o-mini, google/gemini-2.5-flash…)."
          : prov === "mistral"
            ? "Saisis l’identifiant du modèle Mistral (ex. mistral-small-latest)."
            : "Saisis l’identifiant du modèle Claude.",
      );
      return;
    }
    setModelQuickBusy(true);
    try {
      const body: Record<string, string> = { llm_provider: prov };
      if (prov === "openrouter") body.openrouter_model = model;
      else if (prov === "mistral") body.mistral_model = model;
      else body.anthropic_model = model;
      const r = await fetch("/api/korymb-admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j) || `HTTP ${r.status}`);
      setData(j);
      setOk(
        prov === "openrouter"
          ? "Modèle OpenRouter enregistré. Si un JSON de paliers est actif, les appels peuvent utiliser les modèles par niveau de réflexion."
          : prov === "mistral"
            ? "Modèle Mistral enregistré (secours). Configurez les paliers Courant / Médium / Expert ci-dessous pour le routage automatique."
            : "Modèle Anthropic enregistré. Les prochains appels utiliseront cet identifiant.",
      );
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setModelQuickBusy(false);
    }
  }

  /** Vide `llm_tiers_json` côté serveur : plus de routage lite / standard / heavy (uniquement le modèle OpenRouter en tête de page). */
  async function disableTierRouting() {
    setErr("");
    setOk("");
    setTiersDisableBusy(true);
    try {
      const r = await fetch("/api/korymb-admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llm_tiers_json: "" }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j) || `HTTP ${r.status}`);
      setData(j);
      setTiersDraft("");
      setOk("Routage par paliers désactivé. Les appels utilisent uniquement le modèle défini en tête de page.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setTiersDisableBusy(false);
    }
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErr("");
    setOk("");
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    const body: Record<string, string | number> = {};
    const prov = providerDraft.trim();
    if (prov) body.llm_provider = prov;

    const am = anthropicModel.trim();
    if (am) body.anthropic_model = am;
    const mm = mistralModel.trim();
    if (mm) body.mistral_model = mm;
    const mb = mistralBase.trim();
    if (mb) body.mistral_base_url = mb;
    const om = openrouterModel.trim();
    if (om) body.openrouter_model = om;

    const ob = openrouterBase.trim();
    if (ob) body.openrouter_base_url = ob;
    const ore = openrouterReferer.trim();
    if (ore) body.openrouter_http_referer = ore;
    const ot = openrouterTitle.trim();
    if (ot) body.openrouter_app_title = ot;

    const ak = String(fd.get("anthropic_api_key") || "").trim();
    if (ak) body.anthropic_api_key = ak;
    const mk = String(fd.get("mistral_api_key") || "").trim();
    if (mk) body.mistral_api_key = mk;
    const okr = String(fd.get("openrouter_api_key") || "").trim();
    if (okr) body.openrouter_api_key = okr;

    const pin = priceIn.trim();
    const pout = priceOut.trim();
    if (pin) body.llm_price_input_per_million_usd = parseFloat(pin);
    if (pout) body.llm_price_output_per_million_usd = parseFloat(pout);
    if (expertMode) {
      const tiersPayload =
        tiersDraft.trim() ||
        (prov === "mistral" ? defaultMistralTiersJson() : "");
      body.llm_tiers_json = tiersPayload;
    }
    try {
      const r = await fetch("/api/korymb-admin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || JSON.stringify(j) || `HTTP ${r.status}`);
      setData(j);
      setOk("Configuration enregistrée. Les prochains appels utilisent ces paramètres.");
    } catch (errSubmit) {
      setErr(errSubmit instanceof Error ? errSubmit.message : String(errSubmit));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl">
        <ConfigSkeleton />
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6 pb-28">
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Configuration LLM</h1>
          <div className="flex rounded-full border border-slate-200 bg-slate-100 p-1" role="group" aria-label="Niveau de configuration">
            <button
              type="button"
              onClick={() => setConfigMode("essential")}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                !expertMode ? "bg-white text-violet-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Essentiel
            </button>
            <button
              type="button"
              onClick={() => setConfigMode("expert")}
              className={`rounded-full px-3 py-1.5 text-xs font-bold ${
                expertMode ? "bg-white text-violet-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Expert
            </button>
          </div>
        </div>
        {showLegacyHint ? (
          <p className="text-xs text-slate-500">
            Entrée principale :{" "}
            <button type="button" onClick={() => router.push("/configuration")} className="font-medium text-violet-700 underline-offset-2 hover:underline">
              /configuration
            </button>
          </p>
        ) : null}
        <p className="max-w-2xl text-sm text-slate-600">
          {expertMode
            ? "Réglages complets : paliers de réflexion, URLs, coûts estimés et JSON avancé."
            : "L’essentiel : fournisseur, modèle et clé API. Le reste reste accessible en mode Expert."}
        </p>
      </header>

      {err ? (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 shadow-sm"
        >
          <p className="min-w-0 pt-0.5">{err}</p>
          <button type="button" onClick={() => setErr("")} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100">
            Fermer
          </button>
        </div>
      ) : null}
      {ok ? (
        <div
          role="status"
          className="flex items-start justify-between gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-950 shadow-sm"
        >
          <p className="min-w-0 pt-0.5">{ok}</p>
          <button type="button" onClick={() => setOk("")} className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-emerald-900 hover:bg-emerald-100">
            Fermer
          </button>
        </div>
      ) : null}

      {!data && !loading ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-600">Impossible d&apos;afficher le formulaire sans données.</p>
          <button
            type="button"
            onClick={() => void load("refresh")}
            disabled={refreshing}
            className="mt-4 rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {refreshing ? "Nouvelle tentative…" : "Réessayer le chargement"}
          </button>
        </div>
      ) : null}

      {data ? (
        <form onSubmit={onSubmit} className="space-y-6 pb-32 sm:pb-28">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-100 bg-gradient-to-br from-slate-50 to-white px-5 py-5 sm:px-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
                <ActiveProviderBadge provider={providerDraft} />
                <button
                  type="button"
                  onClick={() => void load("refresh")}
                  disabled={refreshing}
                  className="inline-flex w-fit items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
                >
                  {refreshing ? "Rechargement…" : "Recharger depuis le serveur"}
                </button>
              </div>

              <div className="mt-6 space-y-4 lg:grid lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] lg:gap-x-5 lg:gap-y-2 lg:space-y-0">
                <label htmlFor="llm_provider" className={`${fieldLabelClass} lg:col-start-1 lg:row-start-1`}>
                  Fournisseur utilisé pour les appels
                </label>
                <label htmlFor="llm_active_model" className={`${fieldLabelClass} lg:col-start-2 lg:row-start-1`}>
                  {providerDraft === "openrouter"
                    ? "Modèle OpenRouter (secours)"
                    : providerDraft === "mistral"
                      ? "Modèle Mistral (secours)"
                      : "Modèle Claude (identifiant)"}
                </label>
                <span className={`${fieldLabelClass} hidden lg:col-start-3 lg:row-start-1 lg:block`}>Mise à jour</span>

                <div className="lg:col-start-1 lg:row-start-2">
                  <select
                    id="llm_provider"
                    name="llm_provider"
                    value={providerDraft}
                    onChange={(e) => setProviderDraft(e.target.value as LlmProvider)}
                    className={`${inputClass} ${controlH} font-medium`}
                  >
                    <option value="mistral">Mistral AI (recommandé)</option>
                    <option value="anthropic">Anthropic (API native)</option>
                    <option value="openrouter">OpenRouter (option)</option>
                  </select>
                </div>
                <div className="min-w-0 lg:col-start-2 lg:row-start-2">
                  <input
                    id="llm_active_model"
                    name={
                      providerDraft === "openrouter"
                        ? "openrouter_model"
                        : providerDraft === "mistral"
                          ? "mistral_model"
                          : "anthropic_model"
                    }
                    type="text"
                    value={
                      providerDraft === "openrouter"
                        ? openrouterModel
                        : providerDraft === "mistral"
                          ? mistralModel
                          : anthropicModel
                    }
                    onChange={(e) => {
                      if (providerDraft === "openrouter") setOpenrouterModel(e.target.value);
                      else if (providerDraft === "mistral") setMistralModel(e.target.value);
                      else setAnthropicModel(e.target.value);
                    }}
                    className={`${inputClass} ${controlH} font-mono`}
                    placeholder={
                      providerDraft === "openrouter"
                        ? "openai/gpt-4o-mini"
                        : providerDraft === "mistral"
                          ? "mistral-small-latest"
                          : "claude-sonnet-4-20250514"
                    }
                    autoComplete="off"
                  />
                  <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                    {providerDraft === "openrouter"
                      ? "ID exact sur OpenRouter. Utilisé si les paliers de réflexion sont désactivés."
                      : providerDraft === "mistral"
                        ? "Modèle de secours si un palier Courant / Médium / Expert n’est pas configuré."
                        : "Identifiant du modèle Claude côté API Anthropic."}
                  </p>
                </div>
                <div className="flex lg:col-start-3 lg:row-start-2 lg:items-stretch">
                  <button
                    type="button"
                    disabled={modelQuickBusy}
                    onClick={() => void saveModelQuick()}
                    className={`${controlH} inline-flex w-full min-w-[10.5rem] items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto`}
                  >
                    {modelQuickBusy ? "Enregistrement…" : "Appliquer le modèle"}
                  </button>
                </div>
              </div>
            </div>
            <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3 sm:px-6">
              <ApiKeyStatusRow
                kind="mistral"
                label="Clé Mistral"
                configured={Boolean(data.mistral_api_key_set)}
                activeProvider={providerDraft}
              />
              <ApiKeyStatusRow
                kind="anthropic"
                label="Clé Anthropic"
                configured={Boolean(data.anthropic_api_key_set)}
                activeProvider={providerDraft}
              />
              <ApiKeyStatusRow
                kind="openrouter"
                label="Clé OpenRouter"
                configured={Boolean(data.openrouter_api_key_set)}
                activeProvider={providerDraft}
              />
            </div>
            {tierRoutingRelevant && expertMode ? (
              <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 text-xs leading-relaxed text-slate-600">
                    <p className="font-semibold text-slate-800">Routage par niveaux de réflexion</p>
                    <p className="mt-1">
                      {savedTiersActive
                        ? "Les paliers Courant / Médium / Expert sont actifs — chaque type d’appel utilise le modèle adapté."
                        : "Un brouillon JSON est présent dans « Options avancées » (non enregistré tant que vous n’avez pas cliqué sur Enregistrer)."}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={tiersDisableBusy}
                    onClick={() => void disableTierRouting()}
                    className="shrink-0 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-semibold text-red-900 shadow-sm hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {tiersDisableBusy ? "Désactivation…" : "Désactiver le routage par paliers"}
                  </button>
                </div>
              </div>
            ) : null}
            {!expertMode && savedTiersActive ? (
              <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600 sm:px-6">
                Routage par paliers actif — basculez en mode Expert pour modifier.
              </div>
            ) : null}
            {!expertMode ? (
              <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
                <label className={`${labelClass} mb-1.5 block`} htmlFor="essential_api_key">
                  Clé API {providerDraft === "mistral" ? "Mistral" : providerDraft === "anthropic" ? "Anthropic" : "OpenRouter"}
                </label>
                <input
                  id="essential_api_key"
                  name={
                    providerDraft === "mistral"
                      ? "mistral_api_key"
                      : providerDraft === "anthropic"
                        ? "anthropic_api_key"
                        : "openrouter_api_key"
                  }
                  type="password"
                  autoComplete="off"
                  placeholder="Laisser vide pour conserver la clé actuelle"
                  className={`${inputClass} font-mono`}
                />
              </div>
            ) : null}
          </section>

          {expertMode ? (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            {providerDraft === "anthropic" ? (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-slate-900">Anthropic</h2>
                <p className="text-xs text-slate-600">
                  Le modèle se règle en haut à côté du fournisseur, puis <span className="font-medium">Appliquer le modèle</span> pour l’enregistrer tout de suite (sans toucher au reste du formulaire).
                </p>
                {anthropicModels.length ? (
                  <div>
                    <p className={`${labelClass} mb-1.5`}>Raccourcis</p>
                    <div className="flex flex-wrap gap-1.5">
                      {anthropicModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-700 hover:border-violet-300 hover:bg-violet-50/50"
                          onClick={() => setAnthropicModel(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className={`${labelClass} mb-1.5 block`} htmlFor="anthropic_api_key">
                    Clé API
                  </label>
                  <p className="mb-1.5 text-xs text-slate-500">
                    {data.anthropic_api_key_set ? "Déjà enregistrée — ne remplis que pour la faire tourner." : "Obligatoire pour appeler Anthropic."}
                  </p>
                  <input
                    id="anthropic_api_key"
                    name="anthropic_api_key"
                    type="password"
                    autoComplete="off"
                    placeholder={data.anthropic_api_key_set ? "Laisser vide pour conserver" : "sk-ant-…"}
                    className={`${inputClass} font-mono`}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "Enregistrement…" : "Enregistrer la clé"}
                    </button>
                    <p className="text-xs text-slate-500">Enregistre aussi le reste du formulaire visible.</p>
                  </div>
                </div>
              </div>
            ) : providerDraft === "mistral" ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">Mistral AI</h2>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600">
                    Fournisseur principal. Collez votre clé API Mistral, puis cliquez{" "}
                    <span className="font-medium">Enregistrer la clé</span> sous le champ (ou{" "}
                    <span className="font-medium">Enregistrer</span> en bas de page).
                  </p>
                </div>
                {mistralModels.length ? (
                  <div>
                    <p className={`${labelClass} mb-1.5`}>Raccourcis modèle (secours)</p>
                    <div className="flex flex-wrap gap-1.5">
                      {mistralModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-700 hover:border-orange-300 hover:bg-orange-50/50"
                          onClick={() => setMistralModel(m)}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className={`${labelClass} mb-1.5 block`} htmlFor="mistral_api_key">
                    Clé API Mistral
                  </label>
                  <p className="mb-1.5 text-xs text-slate-500">
                    {data.mistral_api_key_set
                      ? "Déjà enregistrée — ne remplissez que pour la faire tourner."
                      : "Obligatoire pour appeler l’API Mistral."}
                  </p>
                  <input
                    id="mistral_api_key"
                    name="mistral_api_key"
                    type="password"
                    autoComplete="off"
                    placeholder={data.mistral_api_key_set ? "Laisser vide pour conserver" : "Votre clé Mistral…"}
                    className={`${inputClass} font-mono`}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-xl bg-orange-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-orange-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "Enregistrement…" : "Enregistrer la clé"}
                    </button>
                    {data.mistral_api_key_set ? (
                      <p className="text-xs font-medium text-emerald-700">Clé enregistrée côté serveur.</p>
                    ) : (
                      <p className="text-xs text-slate-500">Requis avant tout appel LLM Mistral.</p>
                    )}
                  </div>
                </div>
                <div>
                  <label className={`${labelClass} mb-1.5 block`} htmlFor="mistral_base_url">
                    URL de base API
                  </label>
                  <input
                    id="mistral_base_url"
                    name="mistral_base_url"
                    type="url"
                    value={mistralBase}
                    onChange={(e) => setMistralBase(e.target.value)}
                    placeholder="https://api.mistral.ai/v1"
                    className={`${inputClass} font-mono text-xs`}
                  />
                </div>
                <MistralReflectionTiersEditor
                  tiersJson={tiersDraft || defaultMistralTiersJson()}
                  onChange={setTiersDraft}
                />
              </div>
            ) : (
              <div className="space-y-5">
                <h2 className="text-base font-semibold text-slate-900">OpenRouter (option)</h2>
                <p className="text-xs leading-relaxed text-slate-600">
                  Le modèle se saisit en haut à côté du fournisseur (format <span className="font-mono">fournisseur/nom</span>, ex.{" "}
                  <span className="font-mono">google/gemini-2.5-flash</span>), puis <span className="font-medium">Appliquer le modèle</span>. Variantes gratuites : suffixe{" "}
                  <span className="font-mono">:free</span>.
                </p>
                {savedTiersActive ? (
                  <div className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
                    <p className="font-medium">Routage par paliers actif</p>
                    <p className="mt-1 text-amber-900/95">
                      Tant que le JSON « paliers » est rempli, les modèles par palier (lite, standard, heavy) priment sur le champ ci-dessous. Le champ « modèle » sert de{" "}
                      <strong>secours</strong> et pour l’affichage résumé.
                    </p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {Object.entries(tierRouting.tiers || {}).map(([k, v]) => (
                        <li key={k} className="rounded-md bg-white/90 px-2 py-1 font-mono text-[11px] text-slate-800 ring-1 ring-amber-100">
                          <span className="font-sans font-semibold text-violet-800">{k}</span> · {v.model}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {openrouterModels.length ? (
                  <div>
                    <p className={`${labelClass} mb-1.5`}>Raccourcis</p>
                    <div className="flex flex-wrap gap-1.5">
                      {openrouterModels.map((m) => (
                        <button
                          key={m}
                          type="button"
                          title={m}
                          className="max-w-full truncate rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-mono text-slate-700 hover:border-violet-300 hover:bg-violet-50/50"
                          onClick={() => setOpenrouterModel(m)}
                        >
                          {m.endsWith(":free") ? `${m} · gratuit` : m}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div>
                  <label className={`${labelClass} mb-1.5 block`} htmlFor="openrouter_api_key">
                    Clé API
                  </label>
                  <p className="mb-1.5 text-xs text-slate-500">
                    {data.openrouter_api_key_set ? "Déjà enregistrée — optionnel pour rotation." : "Requis pour OpenRouter."}
                  </p>
                  <input
                    id="openrouter_api_key"
                    name="openrouter_api_key"
                    type="password"
                    autoComplete="off"
                    placeholder={data.openrouter_api_key_set ? "Laisser vide pour conserver" : "sk-or-…"}
                    className={`${inputClass} font-mono`}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      disabled={saving}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {saving ? "Enregistrement…" : "Enregistrer la clé"}
                    </button>
                    <p className="text-xs text-slate-500">Enregistre aussi le reste du formulaire visible.</p>
                  </div>
                </div>
              </div>
            )}
          </section>
          ) : null}

          {expertMode ? (
          <section className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/40">
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left sm:px-6"
              aria-expanded={showAdvanced}
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <span>
                <span className="block text-sm font-semibold text-slate-900">Options avancées</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  URL Mistral / OpenRouter, en-têtes optionnels, coûts estimés, JSON des paliers
                </span>
              </span>
              <span className={`shrink-0 text-slate-400 transition-transform ${showAdvanced ? "rotate-180" : ""}`} aria-hidden>
                ▼
              </span>
            </button>
            {showAdvanced ? (
              <div className="space-y-6 border-t border-slate-200 bg-white px-5 py-5 sm:px-6">
                {providerDraft === "openrouter" ? (
                  <div className="grid gap-4">
                    <div>
                      <label className={`${labelClass} mb-1.5 block`} htmlFor="openrouter_base_url">
                        URL de base API
                      </label>
                      <input
                        id="openrouter_base_url"
                        name="openrouter_base_url"
                        type="url"
                        value={openrouterBase}
                        onChange={(e) => setOpenrouterBase(e.target.value)}
                        className={`${inputClass} font-mono text-xs`}
                      />
                    </div>
                    <div>
                      <label className={`${labelClass} mb-1.5 block`} htmlFor="openrouter_http_referer">
                        HTTP Referer <span className="font-normal text-slate-500">(optionnel, stats OpenRouter)</span>
                      </label>
                      <input
                        id="openrouter_http_referer"
                        name="openrouter_http_referer"
                        type="url"
                        value={openrouterReferer}
                        onChange={(e) => setOpenrouterReferer(e.target.value)}
                        className={`${inputClass} font-mono text-xs`}
                      />
                    </div>
                    <div>
                      <label className={`${labelClass} mb-1.5 block`} htmlFor="openrouter_app_title">
                        Titre application <span className="font-normal text-slate-500">(optionnel)</span>
                      </label>
                      <input
                        id="openrouter_app_title"
                        name="openrouter_app_title"
                        type="text"
                        value={openrouterTitle}
                        onChange={(e) => setOpenrouterTitle(e.target.value)}
                        className={inputClass}
                      />
                    </div>
                  </div>
                ) : null}

                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Coûts estimés (USD / million de tokens)</h3>
                  <p className="mt-1 text-xs text-slate-500">Sert au suivi des coûts dans l’interface ; indépendant du tarif réel facturé.</p>
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className={`${labelClass} mb-1.5 block`} htmlFor="llm_price_input_per_million_usd">
                        Entrée
                      </label>
                      <input
                        id="llm_price_input_per_million_usd"
                        name="llm_price_input_per_million_usd"
                        type="number"
                        step="0.01"
                        min="0"
                        value={priceIn}
                        onChange={(e) => setPriceIn(e.target.value)}
                        className={`${inputClass} tabular-nums`}
                      />
                    </div>
                    <div>
                      <label className={`${labelClass} mb-1.5 block`} htmlFor="llm_price_output_per_million_usd">
                        Sortie
                      </label>
                      <input
                        id="llm_price_output_per_million_usd"
                        name="llm_price_output_per_million_usd"
                        type="number"
                        step="0.01"
                        min="0"
                        value={priceOut}
                        onChange={(e) => setPriceOut(e.target.value)}
                        className={`${inputClass} tabular-nums`}
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label className={`${labelClass} block`} htmlFor="llm_tiers_json">
                        Routage par paliers (JSON)
                      </label>
                      <p className="mt-1 text-xs text-slate-500">
                        Définit des modèles différents par charge (lite / standard / heavy). Laisser vide pour n’utiliser que le modèle défini en tête de page à côté du fournisseur.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                        onClick={() => setTiersDraft(DEFAULT_LLM_TIERS_JSON_EXAMPLE)}
                      >
                        Insérer l&apos;exemple
                      </button>
                      <button
                        type="button"
                        disabled={tiersDisableBusy || (!savedTiersActive && !tiersDraftNonEmpty)}
                        className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-900 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-40"
                        onClick={() => void disableTierRouting()}
                      >
                        {tiersDisableBusy ? "…" : "Désactiver (vider le JSON)"}
                      </button>
                    </div>
                  </div>
                  <textarea
                    id="llm_tiers_json"
                    name="llm_tiers_json"
                    value={tiersDraft}
                    onChange={(e) => setTiersDraft(e.target.value)}
                    rows={12}
                    spellCheck={false}
                    placeholder='{ "lite": { "model": "…", "price_input_per_million_usd": 0, "price_output_per_million_usd": 0 } }'
                    className={`${inputClass} min-h-[180px] resize-y font-mono text-xs leading-relaxed`}
                  />
                </div>
              </div>
            ) : null}
          </section>
          ) : null}

          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-safe sm:px-6">
            <div className="pointer-events-auto flex w-full max-w-4xl flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-lg shadow-slate-900/10 backdrop-blur-md sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <p className="text-xs text-slate-500 sm:max-w-md">
                {expertMode
                  ? "Enregistre le fournisseur, les modèles et les options avancées visibles."
                  : "Enregistre le fournisseur, le modèle et la clé API si renseignée."}
              </p>
              <button
                type="submit"
                disabled={saving}
                className="min-h-[44px] shrink-0 rounded-xl bg-slate-900 px-6 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
            </div>
          </div>
        </form>
      ) : null}
    </div>
  );
}
