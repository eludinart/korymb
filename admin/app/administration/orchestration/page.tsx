"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../../lib/api";

type PromptRow = { prompt_key: string; body_chars?: number; updated_at?: string | null };

const KEYS = ["cio_plan_json_user", "cio_synthesis_with_team_user", "cio_synthesis_solo_suffix"] as const;

const TITLES: Record<(typeof KEYS)[number], string> = {
  cio_plan_json_user: "Plan JSON du CIO (délégation + clarifying_questions)",
  cio_synthesis_with_team_user: "Synthèse finale (avec contributions d’équipe)",
  cio_synthesis_solo_suffix: "Suffixe questions finales (CIO seul / hors chat)",
};

const PLACEHOLDERS: Record<(typeof KEYS)[number], string> = {
  cio_plan_json_user: "<<MISSION_TXT>>, <<AGENTS_EXAMPLE_JSON>>, <<SOUS_EXAMPLE_JSON>>, <<KEYS_CSV>>, <<MAX_SUB>>, <<CQ_SCHEMA_FIELD>>, <<CQ_RULE>>",
  cio_synthesis_with_team_user: "<<ROOT_MISSION_LABEL>>, <<CONTRIBUTIONS>>",
  cio_synthesis_solo_suffix: "(Aucun placeholder obligatoire — texte ajouté après la consigne mission en CIO seul)",
};

/** Ce que chaque prompt fait dans le moteur (à lire avant d’éditer). */
const PROMPT_DESCRIPTIONS: Record<(typeof KEYS)[number], string> = {
  cio_plan_json_user:
    "Message **utilisateur** du premier tour CIO : le modèle doit renvoyer uniquement le JSON de plan " +
    "(agents, sous_taches, synthese_attendue, éventuellement clarifying_questions). Le code parse ce JSON, " +
    "normalise les clés et en déduit quels sous-agents tournent. Une erreur ici casse la délégation ou produit un plan vide.",
  cio_synthesis_with_team_user:
    "Message **utilisateur** du tour de synthèse finale lorsqu’au moins un sous-agent a produit un livrable. " +
    "Le système injecte la mission et le bloc « contributions ». Ce texte impose la structure markdown " +
    "(bilan, questions, etc.) visible par le dirigeant.",
  cio_synthesis_solo_suffix:
    "Fragment **concaténé** à la consigne mission quand le CIO répond **sans** sous-agents (hors chat). " +
    "Typiquement questions de fin de mission ou contraintes de forme. Ne modifie pas le system prompt global, " +
    "uniquement ce suffixe utilisateur.",
};

export default function OrchestrationPromptsPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<(typeof KEYS)[number]>("cio_plan_json_user");
  const [draft, setDraft] = useState<Record<string, string>>({});

  const list = useQuery({
    queryKey: ["orchestration-prompts"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/orchestration-prompts", { headers: agentHeaders() });
      return (data.prompts || []) as PromptRow[];
    },
  });

  const detail = useQuery({
    queryKey: ["orchestration-prompt", tab],
    queryFn: async () => {
      const { data } = await requestJson(`/admin/orchestration-prompts/${encodeURIComponent(tab)}`, {
        headers: agentHeaders(),
      });
      return data as { prompt_key: string; body: string };
    },
    enabled: Boolean(tab),
  });

  useEffect(() => {
    if (!detail.data?.prompt_key) return;
    setDraft((prev) => ({ ...prev, [detail.data.prompt_key]: detail.data.body }));
  }, [detail.data]);

  const save = useMutation({
    mutationFn: async () => {
      const body = draft[tab] ?? "";
      await requestJson(`/admin/orchestration-prompts/${encodeURIComponent(tab)}`, {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ body }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orchestration-prompts"] });
      await qc.invalidateQueries({ queryKey: ["orchestration-prompt", tab] });
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      await requestJson(`/admin/orchestration-prompts/${encodeURIComponent(tab)}/reset`, {
        method: "POST",
        headers: agentHeaders(),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["orchestration-prompts"] });
      await qc.invalidateQueries({ queryKey: ["orchestration-prompt", tab] });
    },
  });

  const meta = (list.data || []).find((r) => r.prompt_key === tab);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Prompts d’orchestration</h1>
        <p className="mt-1 text-sm text-slate-500 max-w-3xl leading-relaxed">
          Ces textes pilotent le comportement “moteur” du CIO (plan JSON et structure de synthèse). Placeholders supportés :{" "}
          <span className="font-mono text-xs text-slate-700">{PLACEHOLDERS[tab]}</span>
        </p>
        <div className="mt-3 max-w-3xl rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-950">
          <span className="font-semibold text-amber-900">À quoi tu touches : </span>
          {PROMPT_DESCRIPTIONS[tab]}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === k ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {TITLES[k]}
          </button>
        ))}
      </div>

      {detail.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
      {detail.isError ? <p className="text-sm text-red-700">Impossible de charger le prompt.</p> : null}

      {meta?.updated_at ? (
        <p className="text-xs text-slate-400">
          Dernière mise à jour : <span className="font-mono">{String(meta.updated_at)}</span> ·{" "}
          <span className="font-mono">{Number(meta.body_chars || 0)}</span> caractères
        </p>
      ) : null}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <textarea
          value={draft[tab] ?? ""}
          onChange={(e) => setDraft((prev) => ({ ...prev, [tab]: e.target.value }))}
          rows={22}
          className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-900"
          spellCheck={false}
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => save.mutate()}
            className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-40"
          >
            {save.isPending ? "Sauvegarde…" : "Sauvegarder"}
          </button>
          <button
            type="button"
            disabled={reset.isPending}
            onClick={() => {
              if (confirm("Réinitialiser ce prompt aux valeurs par défaut du dépôt ?")) reset.mutate();
            }}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
          >
            {reset.isPending ? "Reset…" : "Réinitialiser"}
          </button>
        </div>
        {save.isError ? (
          <p className="mt-2 text-sm text-red-700">{save.error instanceof Error ? save.error.message : String(save.error)}</p>
        ) : null}
        {reset.isError ? (
          <p className="mt-2 text-sm text-red-700">{reset.error instanceof Error ? reset.error.message : String(reset.error)}</p>
        ) : null}
      </div>
    </div>
  );
}
