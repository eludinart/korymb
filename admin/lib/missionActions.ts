"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, formatHttpApiErrorPayload, requestJson } from "./api";
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

export async function cioAnswer(jobId: string, answer: string) {
  const { res, data } = await requestJson(`/jobs/${encodeURIComponent(jobId)}/cio-answer`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ answer }),
    expectOk: false,
  });
  if (!res.ok) throw new Error(formatHttpApiErrorPayload(data) || `HTTP ${res.status}`);
  return data;
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
  void qc.invalidateQueries({ queryKey: QK.jobs });
  void qc.invalidateQueries({ queryKey: ["admin-inbox"] });
  void qc.invalidateQueries({ queryKey: ["admin-briefing"] });
  if (jobId) {
    void qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    void qc.invalidateQueries({ queryKey: ["job-live", jobId] });
  }
}

export function useHitlResolve(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof hitlResolve>[1]) => hitlResolve(jobId, body),
    onSuccess: () => {
      invalidateMissionQueries(qc, jobId);
      onSuccess?.();
    },
  });
}

export function useCioAnswer(jobId: string, onSuccess?: () => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (answer: string) => cioAnswer(jobId, answer),
    onSuccess: () => {
      invalidateMissionQueries(qc, jobId);
      onSuccess?.();
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
