"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";
import type { Agent } from "../../lib/types";

type Props = {
  agentKey: string;
  groupId: string;
  allowedToolTags?: string[];
  onClose: () => void;
  onRemovedFromGroup?: () => void;
  canRemoveFromGroup?: boolean;
};

const BASE_TOOL_TAGS = [
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
];

export default function TeamAgentDrawer({
  agentKey,
  groupId,
  allowedToolTags,
  onClose,
  onRemovedFromGroup,
  canRemoveFromGroup,
}: Props) {
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const [role, setRole] = useState("");
  const [system, setSystem] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [formMsg, setFormMsg] = useState("");

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
  });

  const adminAgents = useQuery({
    queryKey: QK.adminAgents,
    queryFn: async () => {
      const { data, res } = await requestJson("/admin/agents", { retries: 0, expectOk: false });
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
      return (data?.agents || []) as Agent[];
    },
    retry: false,
  });

  const agent = (agents.data || []).find((a: { key: string }) => a.key === agentKey) as Agent | undefined;
  const adminRow = (adminAgents.data || []).find((a) => a.key === agentKey);
  const isCustom = agent?.builtin === false || adminRow?.builtin === false;

  useEffect(() => {
    const src = adminRow || agent;
    if (!src) return;
    setLabel(src.label || "");
    setRole(src.role || "");
    setSystem(adminRow?.system || "");
    setTools(Array.isArray(adminRow?.tools) ? [...adminRow.tools] : Array.isArray(agent?.tools) ? [...agent.tools] : []);
    setFormMsg("");
  }, [adminRow, agent, agentKey]);

  const toolTags = useMemo(() => {
    const fromAdmin = adminAgents.data
      ? [...new Set((adminAgents.data || []).flatMap((a) => a.tools || []))].filter(Boolean)
      : [];
    return [...new Set([...BASE_TOOL_TAGS, ...fromAdmin])].sort();
  }, [adminAgents.data]);

  const saveCustom = useMutation({
    mutationFn: async () => {
      const { data, res } = await requestJson(`/admin/agents/custom/${encodeURIComponent(agentKey)}`, {
        method: "PUT",
        body: JSON.stringify({
          label: label.trim() || agentKey,
          role: role.trim(),
          system: system.trim(),
          tools,
        }),
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
    },
    onSuccess: async () => {
      setFormMsg("Modifications enregistrées.");
      await qc.invalidateQueries({ queryKey: QK.agents });
      await qc.invalidateQueries({ queryKey: QK.adminAgents });
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
    },
    onError: (e: unknown) => setFormMsg(e instanceof Error ? e.message : String(e)),
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormMsg("");
    saveCustom.mutate();
  };

  const displayLabel = agent?.label || adminRow?.label || agentKey;
  const displayRole = agent?.role || adminRow?.role || "—";
  const displayTools = agent?.tools || adminRow?.tools || [];
  const builtinLocked = !isCustom;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" className="absolute inset-0 bg-slate-900/40" aria-label="Fermer" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-violet-700">Fiche agent</p>
            <h2 className="mt-1 truncate text-lg font-bold text-slate-900">{displayLabel}</h2>
            <p className="font-mono text-xs text-slate-500">{agentKey}</p>
            <Link
              href={`/administration/agents/${encodeURIComponent(agentKey)}`}
              className="mt-2 inline-block text-xs font-semibold text-violet-700 hover:underline"
            >
              Voir la fiche complète →
            </Link>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-2.5 py-1 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Fermer
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <div>
            <p className="text-sm text-slate-600">{displayRole}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {builtinLocked ? (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                  Builtin
                </span>
              ) : (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-900">
                  Personnalisé
                </span>
              )}
              {agent?.is_manager ? (
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-900">
                  Orchestrateur
                </span>
              ) : null}
            </div>
            <div className="mt-3 flex flex-wrap gap-1">
              {(displayTools || []).length ? (
                (displayTools || []).map((t) => {
                  const blocked = allowedToolTags && allowedToolTags.length > 0 && !allowedToolTags.includes(t);
                  return (
                    <span
                      key={t}
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        blocked ? "bg-amber-50 text-amber-900 line-through" : "bg-slate-100 text-slate-700"
                      }`}
                      title={blocked ? "Hors politique de l’équipe" : undefined}
                    >
                      {t}
                    </span>
                  );
                })
              ) : (
                <span className="text-xs text-slate-400">Aucun outil</span>
              )}
            </div>
          </div>

          {!builtinLocked && adminAgents.isSuccess && adminRow ? (
            <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
              <h3 className="text-sm font-bold text-slate-900">Définition</h3>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Nom affiché</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Fonction</label>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Prompt (system)</label>
                <textarea
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  rows={8}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed"
                />
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-slate-700">Outils</p>
                <div className="flex flex-wrap gap-2">
                  {toolTags.map((t) => {
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
                        title={policyBlocked ? "Hors politique équipe (toujours assignable, signalé)" : undefined}
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
              {formMsg ? (
                <p className={`text-sm ${formMsg.startsWith("Modifications") ? "text-emerald-800" : "text-red-700"}`}>
                  {formMsg}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={saveCustom.isPending}
                className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-50"
              >
                {saveCustom.isPending ? "Enregistrement…" : "Enregistrer l’agent"}
              </button>
            </form>
          ) : null}

          {builtinLocked && adminRow?.system ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Prompt intégré</h3>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-slate-800">
                {adminRow.system}
              </pre>
            </div>
          ) : null}

          {!builtinLocked && adminAgents.isError ? (
            <p className="text-sm text-amber-800">
              Définition complète indisponible (secret admin Next). Ouvrez la fiche dédiée.
            </p>
          ) : null}
        </div>

        <footer className="space-y-2 border-t border-slate-100 px-5 py-4">
          <Link
            href={`/administration/agents/${encodeURIComponent(agentKey)}`}
            className="block rounded-xl bg-violet-700 px-4 py-2.5 text-center text-sm font-bold text-white hover:bg-violet-800"
          >
            Ouvrir la fiche complète →
          </Link>
          {canRemoveFromGroup && onRemovedFromGroup ? (
            <button
              type="button"
              onClick={onRemovedFromGroup}
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Retirer de cette équipe
            </button>
          ) : null}
          <p className="text-center text-[10px] text-slate-400">Équipe {groupId}</p>
        </footer>
      </aside>
    </div>
  );
}
