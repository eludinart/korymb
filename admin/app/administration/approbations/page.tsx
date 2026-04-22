"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requestJson, agentHeaders } from "../../../lib/api";

// ── Types ─────────────────────────────────────────────────────────────────────

type AutonomousOutput = {
  id: string;
  task_id: string;
  job_id: string;
  output_type: "draft" | "article" | "comment" | "veille_summary" | "mission_proposal";
  target_platform: string;
  target_ref: string;
  title: string;
  content: string;
  status: "pending" | "approved" | "rejected" | "published";
  rejection_reason: string;
  approved_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type FilterStatus = "pending" | "approved" | "rejected" | "published" | "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const OUTPUT_TYPE_LABELS: Record<string, string> = {
  draft: "Brouillon",
  article: "Article",
  comment: "Commentaire",
  veille_summary: "Synthèse veille",
  mission_proposal: "Proposition de mission",
};

const OUTPUT_TYPE_COLORS: Record<string, string> = {
  draft: "bg-slate-100 text-slate-700",
  article: "bg-blue-100 text-blue-800",
  comment: "bg-pink-100 text-pink-800",
  veille_summary: "bg-teal-100 text-teal-800",
  mission_proposal: "bg-amber-100 text-amber-800",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  approved: "Approuvé",
  rejected: "Rejeté",
  published: "Publié",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  approved: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-700",
  published: "bg-blue-100 text-blue-800",
};

const PLATFORM_ICONS: Record<string, string> = {
  facebook: "📘",
  instagram: "📸",
  linkedin: "💼",
  website: "🌐",
};

// ── Output card ────────────────────────────────────────────────────────────────

function OutputCard({
  output,
  onApprove,
  onApproveAndPublish,
  onReject,
  busy,
}: {
  output: AutonomousOutput;
  onApprove: (id: string) => void;
  onApproveAndPublish: (id: string) => void;
  onReject: (id: string, reason: string) => void;
  busy: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const isPending = output.status === "pending";
  const hasExternalTarget = ["facebook", "instagram"].includes(output.target_platform);
  const isMissionProposal = output.output_type === "mission_proposal";

  return (
    <div className={`rounded-2xl border p-5 transition-all ${
      isPending
        ? "border-amber-200 bg-amber-50"
        : output.status === "rejected"
        ? "border-red-100 bg-red-50 opacity-60"
        : "border-green-100 bg-green-50 opacity-80"
    }`}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${OUTPUT_TYPE_COLORS[output.output_type] ?? "bg-slate-100 text-slate-700"}`}>
            {OUTPUT_TYPE_LABELS[output.output_type] ?? output.output_type}
          </span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[output.status]}`}>
            {STATUS_LABELS[output.status]}
          </span>
          {output.target_platform && (
            <span className="text-xs text-slate-500">
              {PLATFORM_ICONS[output.target_platform] ?? "🔗"} {output.target_platform}
            </span>
          )}
        </div>
        <span className="text-xs text-slate-400">{fmtDate(output.created_at)}</span>
      </div>

      {/* Title */}
      <p className="mt-2 text-sm font-semibold text-slate-900">{output.title || "(sans titre)"}</p>

      {/* Content preview / expanded */}
      <div className="mt-3">
        <p className={`whitespace-pre-wrap text-sm text-slate-700 ${expanded ? "" : "line-clamp-4"}`}>
          {output.content}
        </p>
        {output.content.length > 300 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-xs text-violet-600 hover:underline"
          >
            {expanded ? "Réduire" : "Voir tout"}
          </button>
        )}
      </div>

      {/* Rejection reason display */}
      {output.status === "rejected" && output.rejection_reason && (
        <p className="mt-2 rounded-lg bg-red-100 px-3 py-2 text-xs text-red-700">
          Motif de rejet : {output.rejection_reason}
        </p>
      )}

      {/* Published info */}
      {output.status === "published" && output.published_at && (
        <p className="mt-2 text-xs text-green-700">Publié le {fmtDate(output.published_at)}</p>
      )}

      {/* Actions for pending outputs */}
      {isPending && !rejectMode && (
        <div className="mt-4 flex flex-wrap gap-2">
          {isMissionProposal ? (
            <button
              onClick={() => onApprove(output.id)}
              disabled={busy}
              className="rounded-lg bg-amber-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              Lancer cette mission
            </button>
          ) : (
            <>
              <button
                onClick={() => onApprove(output.id)}
                disabled={busy}
                className="rounded-lg bg-green-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-50"
              >
                Approuver
              </button>
              {hasExternalTarget && (
                <button
                  onClick={() => onApproveAndPublish(output.id)}
                  disabled={busy}
                  className="rounded-lg bg-blue-700 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  Approuver et publier sur {output.target_platform}
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setRejectMode(true)}
            disabled={busy}
            className="rounded-lg border border-red-200 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            Rejeter
          </button>
        </div>
      )}

      {/* Reject form */}
      {isPending && rejectMode && (
        <div className="mt-4 space-y-2">
          <input
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Motif du rejet (optionnel)"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-red-300"
          />
          <div className="flex gap-2">
            <button
              onClick={() => { onReject(output.id, rejectReason); setRejectMode(false); }}
              disabled={busy}
              className="rounded-lg bg-red-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              Confirmer le rejet
            </button>
            <button
              onClick={() => setRejectMode(false)}
              className="rounded-lg border border-slate-200 px-4 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Annuler
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ApprobationsPage() {
  const qc = useQueryClient();
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("pending");
  const [filterType, setFilterType] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const outputs = useQuery({
    queryKey: ["scheduler-outputs", filterStatus, filterType],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: "100" });
      if (filterStatus) params.set("status", filterStatus);
      if (filterType) params.set("output_type", filterType);
      const { data } = await requestJson(`/scheduler/outputs?${params}`, { headers: agentHeaders() });
      return (data.outputs || []) as AutonomousOutput[];
    },
    refetchInterval: filterStatus === "pending" ? 10000 : false,
  });

  const approveMut = useMutation({
    mutationFn: async ({ id, publish }: { id: string; publish: boolean }) => {
      return requestJson(`/scheduler/outputs/${id}/approve`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ publish_immediately: publish }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler-outputs"] }),
    onSettled: () => setBusyId(null),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      return requestJson(`/scheduler/outputs/${id}/reject`, {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ reason }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scheduler-outputs"] }),
    onSettled: () => setBusyId(null),
  });

  const handleApprove = (id: string) => {
    setBusyId(id);
    approveMut.mutate({ id, publish: false });
  };

  const handleApproveAndPublish = (id: string) => {
    setBusyId(id);
    approveMut.mutate({ id, publish: true });
  };

  const handleReject = (id: string, reason: string) => {
    setBusyId(id);
    rejectMut.mutate({ id, reason });
  };

  const pendingCount = (outputs.data || []).filter((o) => o.status === "pending").length;
  const proposalCount = (outputs.data || []).filter((o) => o.output_type === "mission_proposal" && o.status === "pending").length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">File d'approbation</h1>
          <p className="mt-1 text-sm text-slate-500">
            Outputs générés par les agents autonomes en attente de validation avant publication.
          </p>
        </div>
        {pendingCount > 0 && (
          <div className="flex gap-2">
            <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
              {pendingCount} en attente
            </span>
            {proposalCount > 0 && (
              <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-semibold text-amber-900">
                {proposalCount} proposition{proposalCount > 1 ? "s" : ""} de mission
              </span>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(["pending", "approved", "published", "rejected", ""] as FilterStatus[]).map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterStatus === s
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s === "" ? "Tous" : STATUS_LABELS[s] ?? s}
          </button>
        ))}
        <span className="mx-1 text-slate-200">|</span>
        {(["", "veille_summary", "article", "comment", "mission_proposal", "draft"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setFilterType(t)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterType === t
                ? "bg-violet-900 text-white"
                : "bg-violet-50 text-violet-700 hover:bg-violet-100"
            }`}
          >
            {t === "" ? "Tous types" : OUTPUT_TYPE_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      {/* List */}
      {outputs.isPending ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">
          Chargement…
        </div>
      ) : outputs.isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Erreur de chargement des outputs.
        </div>
      ) : (outputs.data || []).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <p className="text-sm font-medium text-slate-500">
            {filterStatus === "pending"
              ? "Aucun output en attente d'approbation"
              : "Aucun output dans cette catégorie"}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Les outputs générés par les tâches autonomes apparaîtront ici.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {(outputs.data || []).map((output) => (
            <OutputCard
              key={output.id}
              output={output}
              onApprove={handleApprove}
              onApproveAndPublish={handleApproveAndPublish}
              onReject={handleReject}
              busy={busyId === output.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
