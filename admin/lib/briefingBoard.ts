/** Découpage du briefing en files : urgent, à faire, propositions, avertissements. */

export type BoardSourceItem = {
  id?: string;
  kind?: string;
  title?: string;
  mission?: string;
  href?: string;
  severity?: string;
  progress_label?: string;
  job_id?: string;
  ticket_id?: string;
  output_id?: string;
  suggestion_id?: string;
  event_id?: string;
};

export type OpsBoardItem = {
  id?: string;
  title?: string;
  where?: string;
  href?: string;
  kind?: string;
  severity?: string;
  detail?: string;
};

export type OpsBoard = {
  urgent?: OpsBoardItem[];
  todo?: OpsBoardItem[];
  proposals?: OpsBoardItem[];
  warnings?: OpsBoardItem[];
  counts?: {
    urgent?: number;
    todo?: number;
    proposals?: number;
    warnings?: number;
  };
};

export type BoardSignals = {
  recentErrors?: Array<{ job_id?: string; mission?: string; error?: string }>;
  followUpsOverdue?: number;
  followUpsDueToday?: number;
  staleQuotes?: number;
  mailNeedsReply?: number;
  budgetExceeded?: boolean;
  budgetAlert?: boolean;
  llmReady?: boolean;
  llmBlocker?: string | null;
  envelopeBlocked?: boolean;
  envelopePaused?: boolean;
  envelopeWarn?: boolean;
  envelopePercent?: number;
};

const PROPOSAL_KINDS = new Set(["learning_suggestion", "config_suggestion", "scheduler_output"]);

const WHERE_BY_KIND: Record<string, string> = {
  hitl: "Décisions",
  action_ticket: "Décisions",
  cio_question: "Décisions",
  closure: "Décisions",
  quality: "Décisions",
  mission_error: "Missions",
  crm_follow_up: "Planning",
  learning_suggestion: "Mémoire",
  config_suggestion: "Configuration",
  scheduler_output: "Décisions",
  config: "Configuration",
};

const KIND_DETAIL: Record<string, string> = {
  hitl: "Validation dirigeant",
  action_ticket: "Envoi à valider",
  cio_question: "Question en attente",
  closure: "Clôture en attente",
  quality: "Qualité bloquante",
  mission_error: "Mission en échec",
  crm_follow_up: "Relance commerciale",
  learning_suggestion: "Mémoire à confirmer",
  config_suggestion: "Proposition de réglage",
  scheduler_output: "Proposition autonome",
};

function focusHref(item: BoardSourceItem): string {
  if (item.href) return item.href;
  const focus = item.ticket_id || item.job_id || item.output_id || item.suggestion_id || item.event_id;
  if (focus) return `/inbox?triage=1&focus=${encodeURIComponent(focus)}`;
  return "/inbox?triage=1";
}

function rowFromSource(item: BoardSourceItem, index: number): OpsBoardItem {
  const kind = String(item.kind || "");
  const focus = item.ticket_id || item.job_id || item.output_id || item.suggestion_id || item.event_id || item.id || String(index);
  return {
    id: `${kind || "item"}:${focus}`,
    title: (item.title || item.mission || "À traiter").trim(),
    where: WHERE_BY_KIND[kind] || "Décisions",
    href: focusHref(item),
    kind,
    severity: item.severity || "low",
    detail: item.progress_label || KIND_DETAIL[kind] || "",
  };
}

function warn(partial: OpsBoardItem): OpsBoardItem {
  return { kind: "warning", detail: "", ...partial };
}

/** Même découpage que le briefing serveur, à partir de l'inbox déjà chargée. */
export function buildClientOpsBoard(items: BoardSourceItem[], signals: BoardSignals = {}): OpsBoard {
  const actions: OpsBoardItem[] = [];
  const proposals: OpsBoardItem[] = [];
  items.forEach((item, index) => {
    const row = rowFromSource(item, index);
    if (PROPOSAL_KINDS.has(String(row.kind || ""))) proposals.push(row);
    else actions.push(row);
  });

  let urgent = actions.filter((row) => row.severity === "critical" || row.severity === "high");
  const todo = actions.filter((row) => row.severity !== "critical" && row.severity !== "high");
  const warnings: OpsBoardItem[] = [];

  if (signals.llmReady === false) {
    const row = warn({
      id: "llm-blocker",
      title: signals.llmBlocker || "La clé du modèle manque — les missions échouent sans elle",
      where: "Configuration",
      href: "/configuration",
      severity: "critical",
      detail: "Bloque les missions",
    });
    urgent = [row, ...urgent];
    warnings.push(row);
  }

  if (signals.envelopeBlocked || signals.envelopePaused) {
    const row = warn({
      id: "llm-envelope",
      title: signals.envelopePaused ? "L'IA de cet espace est en pause." : "L'enveloppe IA du mois est atteinte.",
      where: "Budget",
      href: "/administration/budget",
      severity: "critical",
      detail: "Bloque les missions",
    });
    urgent = [row, ...urgent];
    warnings.push(row);
  } else if (signals.envelopeWarn) {
    const pct = Number(signals.envelopePercent || 0);
    warnings.push(warn({
      id: "llm-envelope",
      title: pct > 0 ? `Enveloppe IA à ${pct} % ce mois` : "Enveloppe IA bientôt atteinte",
      where: "Budget",
      href: "/administration/budget",
      severity: "high",
      detail: "À surveiller",
    }));
  }

  const seenJobs = new Set(
    urgent.map((row) => String(row.id || "")).filter(Boolean),
  );
  for (const err of signals.recentErrors || []) {
    const jobId = String(err.job_id || "").trim();
    if (!jobId || seenJobs.has(`mission_error:${jobId}`) || seenJobs.has(jobId)) continue;
    const mission = String(err.mission || "").trim() || jobId;
    const detail = String(err.error || "").trim();
    warnings.push(warn({
      id: `err-${jobId}`,
      title: detail ? `Échec — ${mission} : ${detail}` : `Échec — ${mission}`,
      where: "Missions",
      href: `/missions?job=${encodeURIComponent(jobId)}`,
      severity: "high",
    }));
    seenJobs.add(jobId);
  }

  const overdue = Number(signals.followUpsOverdue || 0);
  const due = Number(signals.followUpsDueToday || 0);
  if (overdue > 0) {
    warnings.push(warn({
      id: "crm-overdue",
      title: overdue > 1 ? `${overdue} relances en retard` : "1 relance en retard",
      where: "Planning",
      href: "/gestion/planning",
      severity: "high",
    }));
  } else if (due > 0) {
    warnings.push(warn({
      id: "crm-due",
      title: due > 1 ? `${due} relances aujourd'hui` : "1 relance aujourd'hui",
      where: "Planning",
      href: "/gestion/planning",
      severity: "medium",
    }));
  }

  const stale = Number(signals.staleQuotes || 0);
  if (stale > 0) {
    warnings.push(warn({
      id: "stale-quotes",
      title: stale > 1 ? `${stale} devis sans suite` : "1 devis sans suite",
      where: "Devis",
      href: "/gestion/devis",
      severity: "medium",
    }));
  }

  const mail = Number(signals.mailNeedsReply || 0);
  if (mail > 0) {
    warnings.push(warn({
      id: "mail-reply",
      title: mail > 1 ? `${mail} messages sans réponse` : "1 message sans réponse",
      where: "Courrier",
      href: "/gestion/courrier",
      severity: "high",
    }));
  }

  if ((signals.budgetExceeded || signals.budgetAlert) && !warnings.some((row) => String(row.href || "").startsWith("/administration/budget"))) {
    warnings.push(warn({
      id: "budget",
      title: signals.budgetExceeded ? "Budget IA dépassé" : "Alerte budget IA",
      where: "Budget",
      href: "/administration/budget",
      severity: signals.budgetExceeded ? "critical" : "high",
    }));
  }

  return {
    urgent: urgent.slice(0, 6),
    todo: todo.slice(0, 8),
    proposals: proposals.slice(0, 6),
    warnings: warnings.slice(0, 8),
    counts: {
      urgent: urgent.length,
      todo: todo.length,
      proposals: proposals.length,
      warnings: warnings.length,
    },
  };
}
