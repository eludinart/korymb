"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "./api";
import { isFreeConsigneQuestion } from "./cioArbitrageAnswers";
import { normalizeJobId } from "./missionBossView";
import { QK } from "./queryClient";

export async function hitlResolve(
  jobId: string,
  body: { decision: string; comment?: string; amended_plan?: Record<string, unknown>; feedback?: string },
) {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/hitl/resolve`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify(body),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function cioAnswer(jobId: string, answer: string, question?: string) {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/cio-answer`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ answer, ...(question ? { question } : {}) }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data as { question_answers?: Record<string, string> };
}

function buildArbitrageResumeMessage(answer: string, question?: string): string {
  const trimmed = answer.trim();
  if (isFreeConsigneQuestion(question)) {
    return (
      `Le dirigeant sort des propositions CIO et donne cette consigne à suivre à la place :\n` +
      `${trimmed}\n` +
      `Priorise cette consigne, même si elle s'écarte des questions stratégiques posées.`
    );
  }
  if (question?.trim()) {
    return (
      `Arbitrage dirigeant reçu.\n` +
      `Question : ${question.trim()}\n` +
      `Réponse : ${trimmed}\n` +
      `Intègre cette décision dans la synthèse et les livrables de la mission.`
    );
  }
  return `Arbitrage dirigeant : ${trimmed}\nIntègre cette décision dans la synthèse et les livrables.`;
}

export async function resumeMissionCio(
  parentJobId: string,
  message: string,
  opts?: { cioQuestionsEnabled?: boolean },
) {
  const { res, data } = await requestJson("/chat", {
    method: "POST",
    headers: agentHeaders(),
    timeoutMs: 20_000,
    body: JSON.stringify({
      message,
      agent: "coordinateur",
      history: [],
      linked_job_id: parentJobId,
      mission_config: { cio_questions_enabled: opts?.cioQuestionsEnabled ?? true },
    }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data as { job_id?: string; status?: string };
}

export async function cioAnswerAndResume(
  jobId: string,
  answer: string,
  question?: string,
  opts?: { cioQuestionsEnabled?: boolean },
) {
  const answerRes = await cioAnswer(jobId, answer, question);
  const resume = await resumeMissionCio(jobId, buildArbitrageResumeMessage(answer, question), opts);
  if (resume.status !== "accepted" || !resume.job_id) {
    throw new Error("Reprise mission CIO impossible (pas de job_id).");
  }
  return { ...answerRes, resume_job_id: resume.job_id };
}

export async function validateMission(jobId: string) {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/validate-mission`, {
    method: "POST",
    headers: agentHeaders(),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function closeMission(jobId: string) {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/close-mission`, {
    method: "POST",
    headers: agentHeaders(),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function dismissInboxItem(item: {
  kind: string;
  job_id?: string;
  output_id?: string;
  suggestion_id?: string;
  ticket_id?: string;
}) {
  const { res, data } = await requestJson("/admin/inbox/dismiss", {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({
      kind: item.kind,
      job_id: item.job_id ? normalizeJobId(item.job_id) || null : null,
      output_id: item.output_id || null,
      suggestion_id: item.suggestion_id || null,
      ticket_id: item.ticket_id || null,
    }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function schedulerApprove(outputId: string, launchMode?: "supervised" | "autonomous") {
  const { res, data } = await requestJson(`/scheduler/outputs/${encodeURIComponent(outputId)}/approve`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ launch_mode: launchMode }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function schedulerReject(outputId: string, reason = "") {
  const { res, data } = await requestJson(`/scheduler/outputs/${encodeURIComponent(outputId)}/reject`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ reason }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function resolveLearningSuggestion(suggestionId: string, decision: "approve" | "reject") {
  const { res, data } = await requestJson(
    `/admin/learning-suggestions/${encodeURIComponent(suggestionId)}/resolve`,
    {
      method: "POST",
      headers: agentHeaders(),
      body: JSON.stringify({ decision }),
      expectOk: false,
    },
  );
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export async function qualityOverride(jobId: string, reason = "") {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/quality-override`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ reason }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

function invalidateMissionQueries(qc: ReturnType<typeof useQueryClient>, jobId?: string) {
  void qc.invalidateQueries({ queryKey: QK.jobsCards });
  void qc.invalidateQueries({ queryKey: QK.jobsLight });
  void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
  void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  if (jobId) {
    void qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    void qc.invalidateQueries({ queryKey: ["job-live", jobId] });
  }
}

export async function resolveActionTicket(
  ticketId: string,
  body: { decision: "approve" | "reject"; comment?: string; source?: string },
) {
  const { res, data } = await requestJson(`/actions/${encodeURIComponent(ticketId)}/resolve`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({
      decision: body.decision,
      source: body.source || "inbox",
      comment: body.comment || "",
    }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
}

export function useActionResolve(onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      ticketId,
      decision,
      comment,
    }: {
      ticketId: string;
      decision: "approve" | "reject";
      comment?: string;
    }) => resolveActionTicket(ticketId, { decision, comment }),
    onSuccess: () => {
      invalidateMissionQueries(qc);
      void qc.invalidateQueries({ queryKey: ["business-contacts"] });
      void qc.invalidateQueries({ queryKey: ["business-events"] });
      void qc.invalidateQueries({ queryKey: ["business-overview"] });
      void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      onSuccess?.();
    },
  });
}

export function useHitlResolve(jobId: string, onSuccess?: (data?: unknown) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof hitlResolve>[1]) => hitlResolve(jobId, body),
    onSuccess: (data) => {
      invalidateMissionQueries(qc, jobId);
      void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
      void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
      onSuccess?.(data);
    },
  });
}

export function useCioAnswer(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ answer, question }: { answer: string; question?: string }) =>
      cioAnswer(jobId, answer, question),
    onSuccess: () => {
      invalidateMissionQueries(qc, jobId);
      onSuccess?.();
    },
  });
}

export function useCioAnswerAndResume(
  jobId: string,
  opts?: { cioQuestionsEnabled?: boolean; onSuccess?: (resumeJobId: string) => void },
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ answer, question }: { answer: string; question?: string }) =>
      cioAnswerAndResume(jobId, answer, question, { cioQuestionsEnabled: opts?.cioQuestionsEnabled }),
    onSuccess: (data) => {
      invalidateMissionQueries(qc, jobId);
      if (data.resume_job_id) opts?.onSuccess?.(data.resume_job_id);
    },
  });
}

export function useValidateMission(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => validateMission(jobId),
    onSuccess: () => {
      invalidateMissionQueries(qc, jobId);
      onSuccess?.();
    },
  });
}

export function useCloseMission(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => closeMission(jobId),
    onSuccess: () => {
      invalidateMissionQueries(qc, jobId);
      onSuccess?.();
    },
  });
}

export async function closeInboxBulk(kinds: string[] = ["closure", "mission_error"]) {
  const { res, data } = await requestJson("/admin/inbox/close-bulk", {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ kinds, limit: 200 }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data as { closed_count?: number; skipped_count?: number; closed?: string[] };
}

export function useSchedulerApprove(onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ outputId, launchMode }: { outputId: string; launchMode?: "supervised" | "autonomous" }) =>
      schedulerApprove(outputId, launchMode),
    onSuccess: () => {
      invalidateMissionQueries(qc);
      onSuccess?.();
    },
  });
}

export function useSchedulerReject(onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ outputId, reason }: { outputId: string; reason?: string }) => schedulerReject(outputId, reason),
    onSuccess: () => {
      invalidateMissionQueries(qc);
      onSuccess?.();
    },
  });
}

export function useLearningResolve(onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ suggestionId, decision }: { suggestionId: string; decision: "approve" | "reject" }) =>
      resolveLearningSuggestion(suggestionId, decision),
    onSuccess: () => {
      invalidateMissionQueries(qc);
      onSuccess?.();
    },
  });
}

export function useQualityOverride(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason?: string) => qualityOverride(jobId, reason),
    onSuccess: () => {
      invalidateMissionQueries(qc, jobId);
      onSuccess?.();
    },
  });
}

export function useInboxDismiss(onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: {
      kind: string;
      job_id?: string;
      output_id?: string;
      suggestion_id?: string;
      ticket_id?: string;
    }) => dismissInboxItem(item),
    onSuccess: () => {
      invalidateMissionQueries(qc);
      onSuccess?.();
    },
  });
}
