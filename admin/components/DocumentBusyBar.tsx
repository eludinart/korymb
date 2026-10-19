"use client";

import { useIsFetching, useIsMutating } from "@tanstack/react-query";

function isBackgroundPoll(query: { options: object }) {
  const interval =
    "refetchInterval" in query.options
      ? (query.options as { refetchInterval?: unknown }).refetchInterval
      : undefined;
  if (typeof interval === "function") return true;
  if (typeof interval === "number" && interval > 0) return true;
  return false;
}

/** Barre fine sous le header : lectures / écritures demandées par la page, pas les sondes. */
export default function DocumentBusyBar() {
  const fetching = useIsFetching({
    predicate: (query) => query.state.fetchStatus === "fetching" && !isBackgroundPoll(query),
  });
  const mutating = useIsMutating();
  const active = fetching + mutating > 0;
  if (!active) return null;

  return (
    <div
      className="relative h-0.5 w-full overflow-hidden bg-violet-100"
      role="status"
      aria-live="polite"
      aria-label="Travail en cours en arrière-plan"
    >
      <span className="busy-indeterminate absolute inset-y-0 w-1/3 bg-violet-600" />
    </div>
  );
}
