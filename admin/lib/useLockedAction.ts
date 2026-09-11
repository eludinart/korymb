"use client";

import { useCallback, useRef, useState } from "react";

export type LockedActionPhase = "idle" | "pending" | "done";

type RunOpts = {
  /** Message affiché quand phase === done (sinon garde l’UI appelante). */
  doneMessage?: string;
};

/**
 * Verrou d’action UI : un clic → pending (boutons inutilisables) → done (plus d’action).
 * En erreur, retour à idle pour permettre un nouvel essai.
 */
export function useLockedAction(initialDoneMessage = "") {
  const [phase, setPhase] = useState<LockedActionPhase>("idle");
  const [error, setError] = useState("");
  const [doneMessage, setDoneMessage] = useState(initialDoneMessage);
  const running = useRef(false);

  const run = useCallback(async (fn: () => Promise<void>, opts?: RunOpts) => {
    if (running.current || phase === "pending" || phase === "done") return;
    running.current = true;
    setPhase("pending");
    setError("");
    try {
      await fn();
      if (opts?.doneMessage) setDoneMessage(opts.doneMessage);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      running.current = false;
    }
  }, [phase]);

  const markDone = useCallback((message?: string) => {
    if (message) setDoneMessage(message);
    setPhase("done");
    setError("");
  }, []);

  return {
    phase,
    busy: phase === "pending",
    locked: phase === "pending" || phase === "done",
    isDone: phase === "done",
    error,
    doneMessage,
    run,
    markDone,
    setError,
  };
}
