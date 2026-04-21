"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJson } from "../../../../lib/api";
import { QK } from "../../../../lib/queryClient";

const TOOL_TAGS = ["web", "linkedin", "email", "instagram", "facebook", "drive"] as const;

function slugifyKey(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!s) return "";
  const withPrefix = /^[a-z]/.test(s) ? s : `a_${s}`;
  return withPrefix.slice(0, 48);
}

export default function NouveauAgentPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [autoKey, setAutoKey] = useState(true);
  const [role, setRole] = useState("");
  const [system, setSystem] = useState("");
  const [tools, setTools] = useState<string[]>(["web"]);
  const [msg, setMsg] = useState("");

  const agentsMeta = useQuery({
    queryKey: QK.agents,
    queryFn: async () => {
      const { data } = await requestJson("/agents", { retries: 1 });
      const tags = data?.tool_tags;
      return Array.isArray(tags) && tags.length ? (tags as string[]) : [...TOOL_TAGS];
    },
  });

  const suggestedKey = useMemo(() => slugifyKey(label || keyDraft), [label, keyDraft]);
  const effectiveKey = autoKey ? suggestedKey : slugifyKey(keyDraft);

  const save = useMutation({
    mutationFn: async () => {
      const k = effectiveKey;
      if (!k) throw new Error("Clé technique invalide (nommez l’agent ou saisissez une clé).");
      const { data, res } = await requestJson(`/admin/agents/custom/${encodeURIComponent(k)}`, {
        method: "PUT",
        expectOk: false,
        body: JSON.stringify({
          label: label.trim() || k,
          role: role.trim(),
          system: system.trim(),
          tools,
        }),
      });
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
      return k as string;
    },
    onSuccess: async (k) => {
      setMsg("");
      await qc.invalidateQueries({ queryKey: QK.agents });
      router.push(`/administration/agents/${encodeURIComponent(k)}`);
    },
    onError: (e: unknown) => {
      setMsg(e instanceof Error ? e.message : String(e));
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    save.mutate();
  };

  const tagOptions = agentsMeta.data?.length ? agentsMeta.data : [...TOOL_TAGS];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/administration/agents" className="text-sm text-violet-700 hover:underline">
          ← Agents métiers
        </Link>
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Nouvel agent métier</h1>
        <p className="mt-1 text-sm text-slate-500">
          Définissez le rôle, le périmètre (prompt) et les outils. L’agent pourra être cité par le CIO dans les missions
          (clés techniques identiques à celles du plan JSON).
        </p>
      </div>

      {agentsMeta.isError ? (
        <p className="text-sm text-amber-800">
          Impossible de joindre l’API Korymb pour la liste des outils. Vérifiez que le backend tourne et que l’URL
          proxy est correcte ; les tags par défaut restent utilisables dans le formulaire.
        </p>
      ) : null}

      <form onSubmit={onSubmit} className="space-y-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800">Nom affiché</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="ex. Chargé de partenariats"
            required
          />
        </div>

        <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={autoKey} onChange={(e) => setAutoKey(e.target.checked)} />
            Déduire la clé technique à partir du nom
          </label>
          {!autoKey ? (
            <div className="mt-3">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                Clé technique (slug)
              </label>
              <input
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                placeholder="ex. charge_partenariats"
              />
            </div>
          ) : null}
          <p className="mt-2 font-mono text-xs text-slate-600">
            Clé retenue : <span className="font-semibold text-violet-800">{effectiveKey || "—"}</span>
          </p>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800">Fonction (court descriptif)</label>
          <input
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
            placeholder="ex. Relais institutionnels & dossiers de subvention"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-slate-800">Prompt de périmètre (system)</label>
          <textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            rows={12}
            required
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed"
            placeholder="Tu es … Tu ne fais pas … Tu peux solliciter le CIO via une mission orchestrée …"
          />
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-slate-800">Outils autorisés</p>
          <div className="flex flex-wrap gap-2">
            {tagOptions.map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={tools.includes(t)}
                  onChange={() => {
                    setTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
                  }}
                />
                {t}
              </label>
            ))}
          </div>
        </div>

        {msg ? <p className="text-sm text-red-700">{msg}</p> : null}

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            type="submit"
            disabled={save.isPending || !effectiveKey}
            className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-40"
          >
            {save.isPending ? "Création…" : "Créer l’agent"}
          </button>
          <Link
            href="/administration/agents"
            className="rounded-xl border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Annuler
          </Link>
        </div>
      </form>
    </div>
  );
}
