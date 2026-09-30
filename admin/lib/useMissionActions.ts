"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useActionToast } from "./actionToast";
import { closeMission, validateMission } from "./missionActions";
import { missionActionLabel } from "./missionLabel";
import { QK } from "./queryClient";

const FEEDBACK_TTL_MS = 4_500;

/**
 * Actions dirigeant sur une mission (valider / clôturer) avec états
 * busy / feedback / error partagés — utilisé par /missions et réutilisable ailleurs.
 */
export function useMissionActions() {
  const qc = useQueryClient();
  const { pushToast } = useActionToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!feedback) return;
    const t = window.setTimeout(() => setFeedback(""), FEEDBACK_TTL_MS);
    return () => window.clearTimeout(t);
  }, [feedback]);

  const runAction = async (jobId: string, action: (id: string) => Promise<unknown>, successMessage: string) => {
    setBusyId(jobId);
    setError("");
    setFeedback("");
    try {
      await action(jobId);
      setFeedback(successMessage);
      pushToast(successMessage);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast(msg, "error");
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: QK.jobsCards });
      void qc.invalidateQueries({ queryKey: QK.tokens });
      void qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    }
  };

  const onValidate = (jobId: string, mission?: string | null) =>
    runAction(jobId, validateMission, `« ${missionActionLabel(jobId, mission)} » clôturée.`);

  const onCloseMission = (jobId: string, mission?: string | null) => {
    const ok = window.confirm(
      "Clôturer cette mission ?\n\nElle sort du suivi actif : la poursuite CIO sera désactivée. Les livrables restent consultables.\n\nPour seulement la retirer de Décisions sans la clôturer, utilisez « Mettre de côté ».",
    );
    if (!ok) return Promise.resolve();
    return runAction(jobId, closeMission, `« ${missionActionLabel(jobId, mission)} » clôturée.`);
  };

  /** Alias lisible : archive douce (même API que close). */
  const onShelveMission = (jobId: string, mission?: string | null) => {
    const ok = window.confirm(
      "Mettre de côté cette mission ?\n\nElle ne sera plus proposée dans le suivi actif. Les livrables restent consultables.",
    );
    if (!ok) return Promise.resolve();
    return runAction(jobId, closeMission, `« ${missionActionLabel(jobId, mission)} » mise de côté.`);
  };

  return { busyId, feedback, error, setError, setFeedback, onValidate, onCloseMission, onShelveMission };
}
