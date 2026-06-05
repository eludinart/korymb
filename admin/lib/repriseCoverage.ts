import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "./api";

export type DomainStatus = "covered" | "partial" | "missing";

export type RepriseItemActionKind = "validated" | "noted" | "deferred" | "mission_pending" | "agent_launched";

export type RepriseItemAction = {
  domain_id: string;
  item_text: string;
  action: RepriseItemActionKind;
  note: string;
  output_id: string;
  created_at: string;
  updated_at: string;
};

export type RepriseItemNote = {
  item: string;
  note: string;
  action: string;
};

export type RepriseDomain = {
  id: string;
  label: string;
  description: string;
  status: DomainStatus;
  keyword_hits: string[];
  checklist_covered: string[];
  checklist_missing: string[];
  checklist_deferred?: string[];
  suggested_agents: string[];
  item_notes?: RepriseItemNote[];
};

export type CoverageResult = {
  scanned_at: string;
  coverage_score: number;
  summary: { total_domains: number; covered: number; partial: number; missing: number };
  domains: RepriseDomain[];
  gaps: RepriseDomain[];
  has_reprise_context: boolean;
  user_actions?: Record<string, RepriseItemAction>;
};

export type RepriseChecklistSelection = {
  domain_id: string;
  item_text: string;
  note?: string;
};

export const REPRISE_ACTION_LABELS: Record<RepriseItemActionKind, string> = {
  validated: "Validé",
  noted: "Complété",
  deferred: "Reporté",
  mission_pending: "Mission proposée",
  agent_launched: "Agents lancés",
};

export function memoryContextKeysForAgents(agents: string[]): string[] {
  const keys = new Set<string>(["global"]);
  for (const agent of agents) {
    if (agent === "coordinateur") keys.add("global");
    else if (
      agent === "commercial" ||
      agent === "comptable" ||
      agent === "developpeur" ||
      agent === "community_manager"
    ) {
      keys.add(agent);
    }
  }
  return [...keys];
}

export function repriseItemKey(domainId: string, itemText: string) {
  return `${domainId}::${itemText}`;
}

export const REPRISE_COVERAGE_QUERY_KEY = ["reprise-coverage"] as const;

export const STATUS_LABELS: Record<DomainStatus, string> = {
  covered: "Couvert",
  partial: "Partiel",
  missing: "Manquant",
};

export const STATUS_STYLES: Record<DomainStatus, string> = {
  covered: "border-emerald-200 bg-emerald-50 text-emerald-900",
  partial: "border-amber-200 bg-amber-50 text-amber-900",
  missing: "border-red-200 bg-red-50 text-red-900",
};

export const STATUS_DOT: Record<DomainStatus, string> = {
  covered: "bg-emerald-500",
  partial: "bg-amber-500",
  missing: "bg-red-500",
};

export function repriseDomainHref(domainId: string) {
  return `/administration/reprise#domain-${encodeURIComponent(domainId)}`;
}

export function formatCoveragePct(score: number) {
  return `${Math.round(score * 100)} %`;
}

export function useRepriseCoverage() {
  return useQuery({
    queryKey: REPRISE_COVERAGE_QUERY_KEY,
    queryFn: async () => {
      const res = await requestJson("/admin/reprise/coverage", {
        headers: agentHeaders(),
        timeoutMs: 90_000,
        retries: 1,
      });
      return res.data as CoverageResult;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

function applyCoverage(qc: ReturnType<typeof useQueryClient>, coverage: CoverageResult) {
  qc.setQueryData(REPRISE_COVERAGE_QUERY_KEY, coverage);
}

export function useRepriseItemAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      domain_id: string;
      item_text: string;
      action: "validated" | "noted" | "deferred";
      note?: string;
    }) => {
      const res = await requestJson("/admin/reprise/actions", {
        method: "POST",
        headers: { ...agentHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return res.data as {
        action: RepriseItemAction;
        coverage: CoverageResult;
        memory_contexts_updated?: string[];
      };
    },
    onSuccess: (data) => {
      applyCoverage(qc, data.coverage);
    },
  });
}

export function useRepriseItemsMissions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: RepriseChecklistSelection[]) => {
      const res = await requestJson("/admin/reprise/items/missions", {
        method: "POST",
        headers: { ...agentHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
        timeoutMs: 90_000,
      });
      return res.data as { created: number; message: string; coverage: CoverageResult };
    },
    onSuccess: (data) => {
      applyCoverage(qc, data.coverage);
      if (data.created > 0) {
        qc.invalidateQueries({ queryKey: ["scheduler-outputs"] });
        qc.invalidateQueries({ queryKey: ["admin-inbox"] });
        qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      }
    },
  });
}

export function useRepriseItemsLaunch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      items: RepriseChecklistSelection[];
      launch_mode?: "supervised" | "autonomous";
    }) => {
      const res = await requestJson("/admin/reprise/items/launch", {
        method: "POST",
        headers: { ...agentHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          items: args.items,
          launch_mode: args.launch_mode ?? "supervised",
        }),
        timeoutMs: 90_000,
      });
      return res.data as {
        launched: number;
        message: string;
        coverage: CoverageResult;
        jobs: { job_id: string; agents: string[]; memory_contexts_updated: string[]; relaunch?: boolean }[];
        memory_contexts_updated: string[];
      };
    },
    onSuccess: (data) => {
      applyCoverage(qc, data.coverage);
      qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      qc.invalidateQueries({ queryKey: ["jobs-cards"] });
      qc.invalidateQueries({ queryKey: ["jobs-light"] });
    },
  });
}
