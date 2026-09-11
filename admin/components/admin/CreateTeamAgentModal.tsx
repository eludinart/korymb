"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";

const DEFAULT_TOOLS = [
  "web",
  "linkedin",
  "email",
  "instagram",
  "facebook",
  "drive",
  "media",
  "cms",
  "studio",
  "canva",
  "youtube",
  "pinterest",
  "knowledge",
  "teams",
] as const;

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

type Props = {
  groupId: string;
  memberKeys: string[];
  leadKey: string;
  allowedToolTags?: string[];
  onClose: () => void;
  onCreated: (agentKey: string) => void;
};

export default function CreateTeamAgentModal({
  groupId,
  memberKeys,
  leadKey,
  allowedToolTags,
  onClose,
  onCreated,
}: Props) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [autoKey, setAutoKey] = useState(true);
  const [role, setRole] = useState("");
  const [system, setSystem] = useState("");
  const preferredTools = allowedToolTags?.length ? allowedToolTags.filter((t) => t === "web" || t === "drive") : ["web"];
  const [tools, setTools] = useState<string[]>(preferredTools.length ? preferredTools : ["web"]);
  const [msg, setMsg] = useState("");

  const toolMeta = useQuery({
    queryKey: ["agent-tool-tags"],
    queryFn: async () => {
      const { data } = await requestJson("/agents", { retries: 1 });
      const tags = data?.tool_tags;
      return Array.isArray(tags) && tags.length ? (tags as string[]) : [...DEFAULT_TOOLS];
    },
  });

  const suggestedKey = useMemo(() => slugifyKey(label || keyDraft), [label, keyDraft]);
  const effectiveKey = autoKey ? suggestedKey : slugifyKey(keyDraft);
  const tagOptions = useMemo(() => {
    const base = (toolMeta.data || []).filter((t): t is string => typeof t === "string");
    const merged = base.length ? base : [...DEFAULT_TOOLS];
    return [...new Set([...merged, ...(allowedToolTags || []).filter((t) => typeof t === "string")])].sort();
  }, [toolMeta.data, allowedToolTags]);

  const create = useMutation({
    mutationFn: async () => {
      const k = effectiveKey;
      if (!k) throw new Error("Clé technique invalide (nommez l’agent ou saisissez une clé).");
      if (k === leadKey || memberKeys.includes(k)) {
        throw new Error("Cette clé est déjà dans l’équipe — choisissez un autre nom.");
      }

      const upsert = await requestJson(`/admin/agents/custom/${encodeURIComponent(k)}`, {
        method: "PUT",
        expectOk: false,
        body: JSON.stringify({
          label: label.trim() || k,
          role: role.trim(),
          system: system.trim(),
          tools,
        }),
      });
      if (!upsert.res.ok) {
        throw new Error(String(upsert.data?.detail || upsert.data?.error || `HTTP ${upsert.res.status}`));
      }

      const nextMembers = [...memberKeys.filter((m) => m !== k), k];
      const patch = await requestJson(`/admin/agent-groups/${encodeURIComponent(groupId)}`, {
        method: "PATCH",
        expectOk: false,
        body: JSON.stringify({ member_keys: nextMembers }),
      });
      if (!patch.res.ok) {
        throw new Error(String(patch.data?.detail || `Agent créé, mais ajout à l’équipe échoué : HTTP ${patch.res.status}`));
      }
      return k;
    },
    onSuccess: async (k) => {
      setMsg("");
      await qc.invalidateQueries({ queryKey: QK.agents });
      await qc.invalidateQueries({ queryKey: QK.adminAgents });
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
      onCreated(k);
    },
    onError: (e: unknown) => setMsg(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    create.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fermer" onClick={onClose} />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-violet-700">Nouveau type d’agent</p>
            <h2 className="mt-1 text-lg font-bold text-slate-900">Créer et ajouter à l’équipe</h2>
            <p className="mt-1 text-xs text-slate-500">
              Définissez le rôle, le prompt et les outils. L’agent est créé puis rattaché à cette équipe.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Fermer
          </button>
        </header>

        <form onSubmit={onSubmit} className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Nom affiché</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="ex. Correcteur d’épreuves"
              required
              autoFocus
            />
          </div>

          <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={autoKey} onChange={(e) => setAutoKey(e.target.checked)} />
              Déduire la clé technique à partir du nom
            </label>
            {!autoKey ? (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Clé technique
                </label>
                <input
                  value={keyDraft}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-sm"
                  placeholder="ex. correcteur_epreuves"
                />
              </div>
            ) : null}
            <p className="mt-2 font-mono text-xs text-slate-600">
              Clé : <span className="font-semibold text-violet-800">{effectiveKey || "—"}</span>
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Fonction</label>
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="ex. Relit manuscrits, uniformise le style"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-800">Prompt de périmètre (system)</label>
            <textarea
              value={system}
              onChange={(e) => setSystem(e.target.value)}
              rows={7}
              required
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed"
              placeholder="Tu es … Tu fais … Tu ne fais pas …"
            />
          </div>

          <div>
            <p className="mb-2 text-sm font-medium text-slate-800">Outils</p>
            <div className="flex flex-wrap gap-2">
              {tagOptions.map((t) => {
                const policyBlocked =
                  allowedToolTags && allowedToolTags.length > 0 && !allowedToolTags.includes(t);
                return (
                  <label
                    key={t}
                    className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                      policyBlocked
                        ? "border-amber-200 bg-amber-50 text-amber-900"
                        : "border-slate-200 bg-white text-slate-800"
                    }`}
                    title={policyBlocked ? "Hors politique de l’équipe" : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={tools.includes(t)}
                      onChange={() =>
                        setTools((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
                      }
                    />
                    {t}
                  </label>
                );
              })}
            </div>
          </div>

          {msg ? <p className="text-sm text-red-700">{msg}</p> : null}

          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            <button
              type="submit"
              disabled={create.isPending || !effectiveKey}
              className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-40"
            >
              {create.isPending ? "Création…" : "Créer et ajouter à l’équipe"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
