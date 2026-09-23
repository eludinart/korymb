"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatHttpApiErrorPayload, requestJson } from "../../lib/api";
import { QK } from "../../lib/queryClient";

type AgentDeletePreview = {
  agent_key: string;
  label: string;
  builtin: boolean;
  can_delete: boolean;
  summary: string;
  fleets: { id: string; label: string; role: string }[];
  jobs: { id: string; status: string; mission: string }[];
  jobs_count: number;
  sessions: { id: string; title: string; status: string }[];
  sessions_count: number;
};

type Props = {
  agentKey: string;
  label: string;
  onClose: () => void;
  onDeleted?: () => void;
};

export default function AgentDeleteDialog({ agentKey, label, onClose, onDeleted }: Props) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["agent-delete-preview", agentKey],
    queryFn: async () => {
      const { data, res } = await requestJson(
        `/admin/agents/custom/${encodeURIComponent(agentKey)}/delete-preview`,
        { expectOk: false, retries: 0 },
      );
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
      return data as AgentDeletePreview;
    },
  });

  const remove = useMutation({
    mutationFn: async () => {
      const { data, res } = await requestJson(`/admin/agents/custom/${encodeURIComponent(agentKey)}`, {
        method: "DELETE",
        expectOk: false,
      });
      if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: QK.agents });
      await qc.invalidateQueries({ queryKey: QK.adminAgents });
      await qc.invalidateQueries({ queryKey: ["agent-groups"] });
      onDeleted?.();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl">
        <h3 className="text-lg font-bold text-slate-900">Supprimer « {label} »</h3>
        <p className="mt-1 text-sm text-slate-600">
          La fiche est supprimée seulement si l’agent n’est dans aucune flotte, et s’il n’a ni mission active ni cadrage
          ouvert. Le prompt et les outils se modifient dans la fiche, pas ici.
        </p>
        {preview.isPending ? <p className="mt-4 text-sm text-slate-500">Vérification des usages…</p> : null}
        {preview.isError ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {preview.error instanceof Error ? preview.error.message : "Vérification impossible."}
          </p>
        ) : null}
        {remove.isError ? (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {remove.error instanceof Error ? remove.error.message : "Suppression impossible."}
          </p>
        ) : null}
        {preview.data ? (
          <div className="mt-4 space-y-3">
            <p
              className={`rounded-xl px-3 py-2 text-sm ${
                preview.data.can_delete
                  ? "border border-emerald-200 bg-emerald-50 text-emerald-900"
                  : "border border-amber-200 bg-amber-50 text-amber-950"
              }`}
            >
              {preview.data.summary}
            </p>
            {preview.data.fleets.length > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Flottes</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {preview.data.fleets.map((g) => (
                    <li key={g.id}>
                      <Link
                        href={`/administration/equipes?g=${encodeURIComponent(g.id)}`}
                        className="text-violet-800 hover:underline"
                        onClick={onClose}
                      >
                        {g.label}
                      </Link>
                      <span className="ml-2 text-[11px] text-slate-400">{g.role}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.data.jobs_count > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Missions actives ({preview.data.jobs_count})
                </p>
                <ul className="mt-1 max-h-32 space-y-1 overflow-y-auto text-sm">
                  {preview.data.jobs.map((j) => (
                    <li key={j.id}>
                      <Link href={`/missions?job=${encodeURIComponent(j.id)}`} className="text-violet-800 hover:underline" onClick={onClose}>
                        {j.mission || j.id}
                      </Link>
                      <span className="ml-2 text-[11px] text-slate-400">{j.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {preview.data.sessions_count > 0 ? (
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Cadrages ouverts ({preview.data.sessions_count})
                </p>
                <ul className="mt-1 space-y-1 text-sm">
                  {preview.data.sessions.map((s) => (
                    <li key={s.id}>
                      <Link
                        href={`/missions?mode=guided&session=${encodeURIComponent(s.id)}`}
                        className="text-violet-800 hover:underline"
                        onClick={onClose}
                      >
                        {s.title || s.id}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Link
            href={`/administration/agents/${encodeURIComponent(agentKey)}`}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Ouvrir la fiche
          </Link>
          <button
            type="button"
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            type="button"
            disabled={!preview.data?.can_delete || remove.isPending}
            className="rounded-xl bg-red-700 px-4 py-2 text-sm font-bold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Suppression…" : "Supprimer définitivement"}
          </button>
        </div>
      </div>
    </div>
  );
}
