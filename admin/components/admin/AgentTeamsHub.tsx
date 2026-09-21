"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import TeamAgentDrawer from "./TeamAgentDrawer";
import CreateTeamAgentModal from "./CreateTeamAgentModal";
import TeamMemoryPanel from "./TeamMemoryPanel";
import { requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";
import type { Agent } from "../../lib/types";
import {
  ENTERPRISE_GROUP_ID,
  ENTERPRISE_ROLE_LABEL,
  IDENTITY_CARD,
  IDENTITY_LIST_ACTIVE,
  IDENTITY_LIST_IDLE,
  identityFromGroupId,
} from "../../lib/agentGroupUi";

type DetailTab = "identity" | "roster" | "policy" | "memory";

type MemberRow = {
  key: string;
  label: string;
  role?: string;
  tools?: string[];
  builtin?: boolean;
};

type GroupPolicy = {
  max_agents?: number;
  allowed_tool_tags?: string[];
  hitl_strict?: boolean;
  memory_scope?: string;
  forbid_external_send?: boolean;
  out_of_scope?: string[];
};

type GroupRow = {
  id: string;
  label: string;
  description?: string;
  status: string;
  lead_agent_key: string;
  lead_label?: string;
  lead_role?: string;
  lead_tools?: string[];
  lead_builtin?: boolean;
  member_keys: string[];
  members?: MemberRow[];
  policy?: GroupPolicy;
  is_system?: boolean;
  template_key?: string | null;
  updated_at?: string;
};

type TemplateRow = {
  key: string;
  label: string;
  description: string;
  member_count: number;
};

const POLICY_TOOL_OPTIONS = [
  "web",
  "drive",
  "knowledge",
  "studio",
  "email",
  "linkedin",
  "instagram",
  "facebook",
  "media",
  "cms",
  "canva",
  "youtube",
  "pinterest",
  "teams",
];

function statusBadge(status: string) {
  if (status === "archived") return "bg-slate-100 text-slate-600";
  if (status === "draft") return "bg-amber-50 text-amber-900";
  return "bg-emerald-50 text-emerald-900";
}

export default function AgentTeamsHub() {
  const qc = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlGroup = (searchParams.get("g") || "").trim();

  const [selectedId, setSelectedId] = useState(urlGroup || "");
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [error, setError] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [tplBusy, setTplBusy] = useState<string | null>(null);
  const [drawerKey, setDrawerKey] = useState<string | null>(null);
  const [addMemberKey, setAddMemberKey] = useState("");
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCreateAgent, setShowCreateAgent] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>("roster");

  const [editLabel, setEditLabel] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editLead, setEditLead] = useState("");
  const [editMaxAgents, setEditMaxAgents] = useState(6);
  const [editToolTags, setEditToolTags] = useState<string[]>([]);
  const [editHitl, setEditHitl] = useState(true);
  const [editMemoryScope, setEditMemoryScope] = useState("group");
  const [editForbidSend, setEditForbidSend] = useState(true);
  const [editOutOfScope, setEditOutOfScope] = useState("");

  const groups = useQuery({
    queryKey: ["agent-groups", "admin"],
    queryFn: async () =>
      ((await requestJson("/agent-groups?include_archived=true", { retries: 1 })).data.groups || []) as GroupRow[],
  });

  const templates = useQuery({
    queryKey: ["agent-group-templates"],
    queryFn: async () =>
      ((await requestJson("/agent-groups/templates", { retries: 1 })).data.templates || []) as TemplateRow[],
  });

  const agents = useQuery({
    queryKey: QK.agents,
    queryFn: async () => ((await requestJson("/agents", { retries: 1 })).data.agents || []) as Agent[],
  });

  const filteredGroups = useMemo(() => {
    const list = groups.data || [];
    if (filter === "all") return list;
    if (filter === "archived") return list.filter((g) => g.status === "archived");
    return list.filter((g) => g.status !== "archived");
  }, [groups.data, filter]);

  const selected = useMemo(
    () => (groups.data || []).find((g) => g.id === selectedId) || null,
    [groups.data, selectedId],
  );

  useEffect(() => {
    if (!groups.data?.length) return;
    if (selectedId && groups.data.some((g) => g.id === selectedId)) return;
    const prefer =
      (urlGroup && groups.data.find((g) => g.id === urlGroup)?.id) ||
      groups.data.find((g) => g.id === "entreprise")?.id ||
      groups.data.find((g) => g.status !== "archived")?.id ||
      groups.data[0]?.id ||
      "";
    if (prefer) setSelectedId(prefer);
  }, [groups.data, selectedId, urlGroup]);

  useEffect(() => {
    if (!selectedId) return;
    const next = new URLSearchParams(searchParams.toString());
    if (next.get("g") === selectedId) return;
    next.set("g", selectedId);
    router.replace(`/administration/equipes?${next.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync URL when selection changes only
  }, [selectedId]);

  useEffect(() => {
    if (!selected) return;
    setEditLabel(selected.label || "");
    setEditDescription(selected.description || "");
    setEditLead(selected.lead_agent_key || "");
    const p = selected.policy || {};
    setEditMaxAgents(Number(p.max_agents) || 6);
    setEditToolTags(Array.isArray(p.allowed_tool_tags) ? [...p.allowed_tool_tags] : []);
    setEditHitl(p.hitl_strict !== false);
    setEditMemoryScope(p.memory_scope || "group");
    setEditForbidSend(p.forbid_external_send !== false);
    setEditOutOfScope(Array.isArray(p.out_of_scope) ? p.out_of_scope.join("\n") : "");
    setOkMsg("");
    setError("");
  }, [selected?.id, selected?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDetailTab("roster");
  }, [selectedId]);

  const rosterKeys = useMemo(() => {
    if (!selected) return [] as string[];
    return [selected.lead_agent_key, ...(selected.member_keys || [])].filter(Boolean);
  }, [selected]);

  const candidatesToAdd = useMemo(() => {
    const set = new Set(rosterKeys);
    return (agents.data || []).filter((a) => a.key !== "assistant" && !set.has(a.key));
  }, [agents.data, rosterKeys]);

  const patchGroup = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data, res } = await requestJson(`/admin/agent-groups/${encodeURIComponent(selectedId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      return data?.group as GroupRow;
    },
    onSuccess: async () => {
      setOkMsg("Équipe enregistrée.");
      setError("");
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
    },
    onError: (e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
      setOkMsg("");
    },
  });

  const archive = useMutation({
    mutationFn: async (id: string) => {
      const { data, res } = await requestJson(`/admin/agent-groups/${encodeURIComponent(id)}/archive`, {
        method: "POST",
        expectOk: false,
      });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
    },
    onSuccess: async () => {
      setOkMsg("Équipe archivée.");
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
    },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
  });

  const saveIdentity = (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    const nextLead = editLead || selected.lead_agent_key;
    const body: Record<string, unknown> = {
      label: editLabel.trim() || selected.label,
      description: editDescription.trim(),
      lead_agent_key: nextLead,
    };
    if (nextLead !== selected.lead_agent_key) {
      // Ancien chef rejoint les membres ; le nouveau chef sort de la liste membres.
      const members = [
        selected.lead_agent_key,
        ...(selected.member_keys || []).filter((k) => k !== nextLead),
      ].filter((k) => k && k !== nextLead);
      body.member_keys = members;
    }
    patchGroup.mutate(body);
  };

  const savePolicy = (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    patchGroup.mutate({
      policy: {
        ...(selected.policy || {}),
        max_agents: editMaxAgents,
        allowed_tool_tags: editToolTags,
        hitl_strict: editHitl,
        memory_scope: editMemoryScope,
        forbid_external_send: editForbidSend,
        out_of_scope: editOutOfScope
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
  };

  const changeMemoryScope = (scope: string) => {
    if (!selected) return;
    setEditMemoryScope(scope);
    patchGroup.mutate({
      policy: {
        ...(selected.policy || {}),
        max_agents: editMaxAgents,
        allowed_tool_tags: editToolTags,
        hitl_strict: editHitl,
        memory_scope: scope,
        forbid_external_send: editForbidSend,
        out_of_scope: editOutOfScope
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
      },
    });
  };

  const addMember = () => {
    if (!selected || !addMemberKey) return;
    const next = [...(selected.member_keys || [])];
    if (addMemberKey === selected.lead_agent_key || next.includes(addMemberKey)) return;
    next.push(addMemberKey);
    patchGroup.mutate(
      { member_keys: next },
      {
        onSuccess: () => {
          setAddMemberKey("");
          setOkMsg("Membre ajouté.");
        },
      },
    );
  };

  const removeMember = (key: string) => {
    if (!selected || key === selected.lead_agent_key) return;
    if (!window.confirm(`Retirer « ${key} » de l’équipe ?`)) return;
    const next = (selected.member_keys || []).filter((k) => k !== key);
    patchGroup.mutate(
      { member_keys: next },
      {
        onSuccess: () => {
          setDrawerKey(null);
          setOkMsg("Membre retiré.");
        },
      },
    );
  };

  const spawnFromTemplate = async (templateKey: string) => {
    setTplBusy(templateKey);
    setError("");
    try {
      const { data, res } = await requestJson("/team-blueprints/propose-template", {
        method: "POST",
        expectOk: false,
        body: JSON.stringify({ template_key: templateKey, intent: `Template ${templateKey}` }),
      });
      if (!res.ok) throw new Error(String(data?.detail || `HTTP ${res.status}`));
      const bpId = data?.blueprint?.id;
      if (!bpId) throw new Error("Blueprint non créé");
      const conf = await requestJson(`/team-blueprints/${encodeURIComponent(bpId)}/confirm`, {
        method: "POST",
        expectOk: false,
      });
      if (!conf.res.ok) throw new Error(String(conf.data?.detail || `HTTP ${conf.res.status}`));
      const newId = conf.data?.group?.id as string | undefined;
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
      await qc.invalidateQueries({ queryKey: QK.agents });
      setOkMsg("Équipe créée depuis le template.");
      if (newId) setSelectedId(newId);
      setShowTemplates(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTplBusy(null);
    }
  };

  const leadCard: MemberRow | null = selected
    ? {
        key: selected.lead_agent_key,
        label: selected.lead_label || selected.lead_agent_key,
        role: selected.lead_role || "Chef d’équipe",
        tools: selected.lead_tools,
        builtin: selected.lead_builtin,
      }
    : null;

  const memberCards = selected?.members || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Équipes d’agents</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Pilotez les flottes par organigramme : identité, composition, politique, puis chaque rôle en un clic.
            L’Assistant propose des équipes projet ; la flotte <strong>Entreprise</strong> reste le défaut métier. Ici vous affinez composition, politique et mémoire.
          </p>
          <p className="mt-2 text-sm">
            <Link href="/chat" className="font-semibold text-violet-700 underline-offset-2 hover:underline">
              Chat Assistant
            </Link>
            {" · "}
            <Link
              href="/administration/agents"
              className="font-semibold text-violet-700 underline-offset-2 hover:underline"
            >
              Fiches agents
            </Link>
            {" · "}
            <Link
              href="/administration/agents/nouveau"
              className="font-semibold text-violet-700 underline-offset-2 hover:underline"
            >
              + Nouvel agent
            </Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-2.5 text-sm font-bold text-violet-900 hover:bg-violet-100"
          >
            {showTemplates ? "Masquer templates" : "Créer depuis template"}
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>
      ) : null}
      {okMsg ? (
        <p className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{okMsg}</p>
      ) : null}

      {showTemplates ? (
        <section className="rounded-2xl border border-violet-100 bg-violet-50/40 p-4">
          <h2 className="text-sm font-bold text-slate-900">Templates d’équipe</h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-3">
            {(templates.data || []).map((t) => (
              <li key={t.key} className="rounded-xl border border-white bg-white p-3 shadow-sm">
                <p className="font-semibold text-slate-900">{t.label}</p>
                <p className="mt-1 text-xs text-slate-500">{t.description}</p>
                <p className="mt-2 text-[11px] text-slate-400">{t.member_count} rôles</p>
                <button
                  type="button"
                  disabled={!!tplBusy}
                  onClick={() => void spawnFromTemplate(t.key)}
                  className="mt-3 w-full rounded-lg bg-violet-700 px-3 py-2 text-sm font-bold text-white hover:bg-violet-800 disabled:opacity-60"
                >
                  {tplBusy === t.key ? "Création…" : "Créer l’équipe"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <aside className="w-full shrink-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm lg:sticky lg:top-28 lg:w-64">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1">
            {(
              [
                ["active", "Actives"],
                ["archived", "Archivées"],
                ["all", "Toutes"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[11px] font-bold ${
                  filter === k ? "bg-white text-violet-800 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {groups.isLoading ? <p className="mt-3 text-sm text-slate-400">Chargement…</p> : null}
          <ul className="mt-3 max-h-[60vh] space-y-1 overflow-y-auto">
            {filteredGroups.map((g) => {
              const active = g.id === selectedId;
              const count = 1 + (g.member_keys?.length || 0);
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(g.id)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${
                      active
                        ? IDENTITY_LIST_ACTIVE[identityFromGroupId(g.id)]
                        : IDENTITY_LIST_IDLE[identityFromGroupId(g.id)]
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-semibold">{g.label}</span>
                      <span className={`text-[10px] font-bold ${active ? "text-white/80" : g.is_system ? "text-amber-700" : "text-slate-400"}`}>
                        {count}
                      </span>
                    </span>
                    <span className={`mt-0.5 block truncate text-[11px] ${active ? "text-white/80" : g.is_system ? "text-amber-800" : "text-slate-500"}`}>
                      {g.is_system ? `${ENTERPRISE_ROLE_LABEL} · ` : ""}
                      {g.lead_label || g.lead_agent_key}
                    </span>
                  </button>
                </li>
              );
            })}
            {!filteredGroups.length && !groups.isLoading ? (
              <li className="px-2 py-4 text-center text-xs text-slate-400">Aucune équipe</li>
            ) : null}
          </ul>
        </aside>

        <main className="min-w-0 flex-1 space-y-5">
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-16 text-center text-sm text-slate-500">
              Sélectionnez une équipe à gauche, ou créez-en une depuis un template.
            </div>
          ) : (
            <>
              <section
                className={`rounded-2xl border p-5 shadow-sm ${
                  selected.is_system || selected.id === ENTERPRISE_GROUP_ID
                    ? IDENTITY_CARD.orchestra
                    : IDENTITY_CARD.project
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-bold text-slate-900">{selected.label}</h2>
                      {selected.is_system ? (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-950">
                          {ENTERPRISE_ROLE_LABEL}
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadge(selected.status)}`}
                      >
                        {selected.status}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-xs text-slate-400">{selected.id}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Link
                      href={`/chat?group=${encodeURIComponent(selected.id)}`}
                      className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-bold text-white hover:bg-violet-800"
                    >
                      Tester dans le chat
                    </Link>
                    {!selected.is_system && selected.status !== "archived" ? (
                      <button
                        type="button"
                        className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                        onClick={() => {
                          if (window.confirm(`Archiver « ${selected.label} » ?`)) archive.mutate(selected.id);
                        }}
                      >
                        Archiver
                      </button>
                    ) : null}
                  </div>
                </div>

                <nav className="mt-5 flex flex-wrap gap-1 border-b border-slate-200 pb-0" aria-label="Sections équipe">
                  {(
                    [
                      ["identity", "Identité"],
                      ["roster", "Composition"],
                      ["policy", "Politique"],
                      ["memory", "Mémoire"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setDetailTab(id)}
                      className={`-mb-px rounded-t-lg px-3 py-2 text-sm font-bold transition ${
                        detailTab === id
                          ? "border border-b-white border-slate-200 bg-white text-violet-800"
                          : "border border-transparent text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </nav>
              </section>

              {detailTab === "identity" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <form onSubmit={saveIdentity} className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-1">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Nom</label>
                    <input
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      required
                    />
                  </div>
                  <div className="sm:col-span-1">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Chef d’équipe</label>
                    <select
                      value={editLead}
                      onChange={(e) => setEditLead(e.target.value)}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    >
                      {rosterKeys.map((k) => {
                        const m =
                          k === selected.lead_agent_key
                            ? leadCard
                            : memberCards.find((x) => x.key === k);
                        return (
                          <option key={k} value={k}>
                            {m?.label || k}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="mb-1 block text-xs font-semibold text-slate-700">Intention / description</label>
                    <textarea
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      rows={2}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      placeholder="À quoi sert cette équipe ?"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={patchGroup.isPending}
                      className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      {patchGroup.isPending ? "Enregistrement…" : "Enregistrer l’identité"}
                    </button>
                  </div>
                </form>
              </section>
              ) : null}

              {detailTab === "roster" ? (
              <section className="space-y-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">Composition</h3>
                    <p className="text-xs text-slate-500">
                      « Ouvrir la fiche » = page complète (prompt, outils, mémoire). « Ajuster ici » = panneau rapide.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowCreateAgent(true)}
                      className="rounded-xl bg-violet-700 px-3 py-2 text-sm font-bold text-white hover:bg-violet-800"
                    >
                      + Nouveau type d’agent
                    </button>
                    <select
                      value={addMemberKey}
                      onChange={(e) => setAddMemberKey(e.target.value)}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
                    >
                      <option value="">Réutiliser un agent…</option>
                      {candidatesToAdd.map((a) => (
                        <option key={a.key} value={a.key}>
                          {a.label} ({a.key})
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!addMemberKey || patchGroup.isPending}
                      onClick={addMember}
                      className="rounded-xl border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-bold text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                    >
                      Ajouter
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {leadCard ? (
                    <article className="flex flex-col rounded-2xl border-2 border-violet-300 bg-gradient-to-br from-violet-50 to-white p-4 shadow-sm">
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-violet-700">Chef</p>
                      <p className="mt-1 font-bold text-slate-900">{leadCard.label}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">{leadCard.key}</p>
                      <p className="mt-2 line-clamp-2 flex-1 text-xs text-slate-600">{leadCard.role || "—"}</p>
                      <div className="mt-3 flex flex-wrap gap-1">
                        {(leadCard.tools || []).slice(0, 4).map((t) => (
                          <span key={t} className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] text-slate-700">
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setDrawerKey(leadCard.key)}
                          className="rounded-lg border border-violet-200 bg-white px-3 py-1.5 text-xs font-bold text-violet-900 hover:bg-violet-50"
                        >
                          Ajuster ici
                        </button>
                        <Link
                          href={`/administration/agents/${encodeURIComponent(leadCard.key)}`}
                          className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-800"
                        >
                          Ouvrir la fiche →
                        </Link>
                      </div>
                    </article>
                  ) : null}

                  {memberCards.map((m) => (
                    <article
                      key={m.key}
                      className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                    >
                      <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Membre</p>
                      <p className="mt-1 font-bold text-slate-900">{m.label}</p>
                      <p className="mt-0.5 font-mono text-[11px] text-slate-500">{m.key}</p>
                      <p className="mt-2 line-clamp-2 flex-1 text-xs text-slate-600">{m.role || "—"}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {m.builtin === false ? (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-900">
                            Custom
                          </span>
                        ) : null}
                        {(m.tools || []).slice(0, 4).map((t) => (
                          <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                            {t}
                          </span>
                        ))}
                      </div>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setDrawerKey(m.key)}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 hover:bg-slate-50"
                        >
                          Ajuster ici
                        </button>
                        <Link
                          href={`/administration/agents/${encodeURIComponent(m.key)}`}
                          className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-800"
                        >
                          Ouvrir la fiche →
                        </Link>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
              ) : null}

              {detailTab === "policy" ? (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">Politique</h3>
                <p className="mt-1 text-xs text-slate-500">
                  Garde-fous de l’équipe (outils autorisés, HITL, mémoire, hors périmètre).
                </p>
                <form onSubmit={savePolicy} className="mt-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Max agents</label>
                      <input
                        type="number"
                        min={2}
                        max={12}
                        value={editMaxAgents}
                        onChange={(e) => setEditMaxAgents(Number(e.target.value) || 6)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700">Mémoire</label>
                      <select
                        value={editMemoryScope}
                        onChange={(e) => setEditMemoryScope(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                      >
                        <option value="group">Équipe / mission</option>
                        <option value="enterprise">Partagée (workspace)</option>
                        <option value="none">Aucune</option>
                      </select>
                      <button
                        type="button"
                        className="mt-1 text-[11px] font-semibold text-violet-700 hover:underline"
                        onClick={() => setDetailTab("memory")}
                      >
                        Voir l’onglet Mémoire →
                      </button>
                    </div>
                    <div className="flex flex-col justify-end gap-2 pb-1">
                      <label className="flex items-center gap-2 text-sm text-slate-800">
                        <input type="checkbox" checked={editHitl} onChange={(e) => setEditHitl(e.target.checked)} />
                        HITL strict
                      </label>
                      <label className="flex items-center gap-2 text-sm text-slate-800">
                        <input
                          type="checkbox"
                          checked={editForbidSend}
                          onChange={(e) => setEditForbidSend(e.target.checked)}
                        />
                        Interdire envois externes
                      </label>
                    </div>
                  </div>
                  {selected.id !== ENTERPRISE_GROUP_ID ? (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-700">
                      Hors périmètre (un item par ligne)
                    </label>
                    <textarea
                      value={editOutOfScope}
                      onChange={(e) => setEditOutOfScope(e.target.value)}
                      rows={4}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm leading-relaxed"
                      placeholder="prospection commerciale&#10;publication réseaux sociaux&#10;facturation"
                    />
                    <p className="mt-1 text-[11px] text-slate-500">
                      Injecté aux agents au runtime : ils restent sur la mission de l’équipe et
                      n’élargissent pas aux opérations de l’entreprise entière.
                    </p>
                  </div>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs font-semibold text-slate-700">Tags d’outils autorisés</p>
                    <div className="flex flex-wrap gap-2">
                      {POLICY_TOOL_OPTIONS.map((t) => (
                        <label
                          key={t}
                          className="flex cursor-pointer items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={editToolTags.includes(t)}
                            onChange={() =>
                              setEditToolTags((prev) =>
                                prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                              )
                            }
                          />
                          {t}
                        </label>
                      ))}
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={patchGroup.isPending}
                    className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {patchGroup.isPending ? "Enregistrement…" : "Enregistrer la politique"}
                  </button>
                </form>
              </section>
              ) : null}

              {detailTab === "memory" ? (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <TeamMemoryPanel
                    groupId={selected.id}
                    groupLabel={selected.label}
                    memoryScope={editMemoryScope}
                    onChangeScope={changeMemoryScope}
                    scopeBusy={patchGroup.isPending}
                  />
                </section>
              ) : null}
            </>
          )}
        </main>
      </div>

      {drawerKey && selected ? (
        <TeamAgentDrawer
          agentKey={drawerKey}
          groupId={selected.id}
          allowedToolTags={selected.policy?.allowed_tool_tags}
          onClose={() => setDrawerKey(null)}
          canRemoveFromGroup={drawerKey !== selected.lead_agent_key}
          onRemovedFromGroup={() => removeMember(drawerKey)}
        />
      ) : null}

      {showCreateAgent && selected ? (
        <CreateTeamAgentModal
          groupId={selected.id}
          memberKeys={selected.member_keys || []}
          leadKey={selected.lead_agent_key}
          allowedToolTags={selected.policy?.allowed_tool_tags}
          onClose={() => setShowCreateAgent(false)}
          onCreated={(key) => {
            setShowCreateAgent(false);
            setOkMsg(`Agent « ${key} » créé et ajouté à l’équipe.`);
            setDrawerKey(key);
          }}
        />
      ) : null}
    </div>
  );
}
