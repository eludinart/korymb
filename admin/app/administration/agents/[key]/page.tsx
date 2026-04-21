"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import EnterpriseMemoryContextPanel from "../../../../components/EnterpriseMemoryContextPanel";
import HealthDot from "../../../../components/HealthDot";
import { memoryContextKeyForAgent } from "../../../../lib/agentMemory";
import { requestJson } from "../../../../lib/api";
import { QK } from "../../../../lib/queryClient";

const visibleInterval = (ms: number) =>
  typeof document !== "undefined" && document.visibilityState === "visible" ? ms : false;

type AgentRow = {
  key: string;
  label: string;
  role?: string;
  tools?: string[];
  is_manager?: boolean;
  builtin?: boolean;
  system?: string;
};

export default function AdministrationAgentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const rawKey = typeof params?.key === "string" ? params.key : Array.isArray(params?.key) ? params.key[0] : "";
  const agentKey = decodeURIComponent(rawKey || "");

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => (await requestJson("/agents", { retries: 1 })).data.agents || [],
    refetchInterval: () => visibleInterval(30000),
  });

  const adminAgents = useQuery({
    queryKey: QK.adminAgents,
    queryFn: async () => {
      const { data, res } = await requestJson("/admin/agents", { retries: 0, expectOk: false });
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
      return (data?.agents || []) as AgentRow[];
    },
    retry: false,
  });

  const agent = (agents.data || []).find((a: { key: string }) => a.key === agentKey) as AgentRow | undefined;
  const adminRow = (adminAgents.data || []).find((a) => a.key === agentKey);
  const isBuiltin = Boolean(agent?.builtin);

  const memoryKey = memoryContextKeyForAgent(agentKey);

  const [label, setLabel] = useState("");
  const [role, setRole] = useState("");
  const [system, setSystem] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [formMsg, setFormMsg] = useState("");

  useEffect(() => {
    if (!adminRow) return;
    setLabel(adminRow.label || "");
    setRole(adminRow.role || "");
    setSystem(adminRow.system || "");
    setTools(Array.isArray(adminRow.tools) ? [...adminRow.tools] : []);
  }, [adminRow]);

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
    },
    onError: (e: unknown) => {
      setFormMsg(e instanceof Error ? e.message : String(e));
    },
  });

  const deleteCustom = useMutation({
    mutationFn: async () => {
      const { data, res } = await requestJson(`/admin/agents/custom/${encodeURIComponent(agentKey)}`, {
        method: "DELETE",
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || data?.error || `HTTP ${res.status}`));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK.agents });
      await qc.invalidateQueries({ queryKey: QK.adminAgents });
      router.push("/administration/agents");
    },
    onError: (e: unknown) => {
      setFormMsg(e instanceof Error ? e.message : String(e));
    },
  });

  const onSubmitCustom = (e: FormEvent) => {
    e.preventDefault();
    setFormMsg("");
    saveCustom.mutate();
  };

  if (agents.isSuccess && !agent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-red-700">Agent « {agentKey} » introuvable.</p>
        <Link href="/administration/agents" className="text-sm font-medium text-violet-700 underline">
          Retour à la liste
        </Link>
      </div>
    );
  }

  const memoryDescription =
    agentKey === "coordinateur"
      ? "Texte global injecté dans la vision CIO et les extraits transverses ; les autres rôles ont leur propre volet modifiable depuis leur fiche."
      : "Notes persistées pour ce rôle ; elles complètent le contexte global lors des missions et du chat direct.";

  const toolTags = (() => {
    const fromAdmin = adminAgents.data
      ? [...new Set((adminAgents.data || []).flatMap((a) => a.tools || []))].filter(Boolean)
      : [];
    const base = ["web", "linkedin", "email", "instagram", "facebook", "drive"];
    return [...new Set([...base, ...fromAdmin])].sort();
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/administration/agents" className="text-sm text-violet-700 hover:underline">
          ← Agents métiers
        </Link>
      </div>
      {agents.isLoading ? <p className="text-sm text-slate-400">Chargement…</p> : null}
      {agent ? (
        <>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">{agent.label}</h1>
                <p className="mt-1 font-mono text-sm text-slate-500">{agent.key}</p>
                <p className="mt-2 text-sm text-slate-600">{agent.role || "—"}</p>
                {agent.builtin === false ? (
                  <p className="mt-2 inline-flex rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-900">
                    Agent personnalisé (modifiable)
                  </p>
                ) : null}
              </div>
              <HealthDot tone="ok" label="Agent défini côté serveur" size="md" />
            </div>
            {agent.is_manager ? (
              <p className="mt-3 inline-flex rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-900">
                Orchestrateur multi-agents
              </p>
            ) : null}
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Outils déclarés</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {(agent.tools || []).length ? (
                  (agent.tools || []).map((t: string) => (
                    <span key={t} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-800">
                      {t}
                    </span>
                  ))
                ) : (
                  <span className="text-sm text-slate-500">Aucun outil listé pour ce rôle.</span>
                )}
              </div>
            </div>
          </div>

          {!isBuiltin && adminAgents.isSuccess && adminRow ? (
            <form onSubmit={onSubmitCustom} className="space-y-4 rounded-2xl border border-violet-100 bg-violet-50/40 p-5 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-900">Définition de l’agent</h2>
              <p className="text-sm text-slate-600">
                Ajustez le nom, la fonction, le prompt de périmètre et les outils. La clé technique « {agentKey} » ne peut
                pas être renommée ici (supprimez et recréez si besoin).
              </p>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-800">Nom affiché</label>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-800">Fonction</label>
                <input
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-800">Prompt de périmètre (system)</label>
                <textarea
                  value={system}
                  onChange={(e) => setSystem(e.target.value)}
                  rows={10}
                  required
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm leading-relaxed"
                />
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-slate-800">Outils</p>
                <div className="flex flex-wrap gap-2">
                  {toolTags.map((t) => (
                    <label
                      key={t}
                      className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm"
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
                  ))}
                </div>
              </div>
              {formMsg ? (
                <p className={`text-sm ${formMsg.startsWith("Modifications") ? "text-emerald-800" : "text-red-700"}`}>
                  {formMsg}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-3 pt-1">
                <button
                  type="submit"
                  disabled={saveCustom.isPending}
                  className="rounded-xl bg-violet-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-40"
                >
                  {saveCustom.isPending ? "Enregistrement…" : "Enregistrer"}
                </button>
                <button
                  type="button"
                  disabled={deleteCustom.isPending}
                  onClick={() => {
                    if (typeof window !== "undefined" && window.confirm("Supprimer définitivement cet agent ?")) {
                      deleteCustom.mutate();
                    }
                  }}
                  className="rounded-xl border border-red-200 bg-white px-5 py-2.5 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-40"
                >
                  {deleteCustom.isPending ? "Suppression…" : "Supprimer l’agent"}
                </button>
              </div>
            </form>
          ) : null}

          {!isBuiltin && adminAgents.isError ? (
            <p className="text-sm text-amber-800">
              Chargement de la définition complète impossible (vérifiez KORYMB_AGENT_SECRET côté serveur Next). Mémoire
              entreprise ci-dessous si disponible.
            </p>
          ) : null}

          {isBuiltin && adminAgents.isSuccess && adminRow?.system ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Prompt intégré (lecture seule)</h2>
              <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-white p-3 font-mono text-xs text-slate-800">
                {adminRow.system}
              </pre>
            </div>
          ) : null}

          {memoryKey ? (
            <EnterpriseMemoryContextPanel
              contextKey={memoryKey}
              memoryTitle={agent.label}
              description={memoryDescription}
              showRecentMissions={memoryKey === "global"}
            />
          ) : (
            <p className="text-sm text-slate-500">Aucun volet mémoire dédié pour cet agent.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
