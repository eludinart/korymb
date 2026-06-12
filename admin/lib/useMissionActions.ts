"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { closeMission, validateMission } from "./missionActions";
import { QK } from "./queryClient";

/**
 * Actions dirigeant sur une mission (valider / clôturer) avec états
 * busy / feedback / error partagés — utilisé par /missions et réutilisable ailleurs.
 */
export function useMissionActions() {
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  const runAction = async (jobId: string, action: (id: string) => Promise<unknown>, successMessage: string) => {
    setBusyId(jobId);
    setError("");
    setFeedback("");
    try {
      await action(jobId);
      setFeedback(successMessage);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
      void qc.invalidateQueries({ queryKey: QK.jobsCards });
      void qc.invalidateQueries({ queryKey: QK.tokens });
      void qc.invalidateQueries({ queryKey: ["job-detail-live", jobId] });
    }
  };

  const onValidate = (jobId: string) => runAction(jobId, validateMission, `Mission #${jobId} validée.`);

  const onCloseMission = (jobId: string) => {
    const ok = window.confirm(
      "Clôturer cette mission ?\n\nVous la considérez terminée : elle ne sera plus modifiable (poursuite CIO désactivée). Les livrables restent consultables.",
    );
    if (!ok) return Promise.resolve();
    return runAction(jobId, closeMission, `Mission #${jobId} clôturée.`);
  };

  return { busyId, feedback, error, setError, setFeedback, onValidate, onCloseMission };
}
