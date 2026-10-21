"use client";

import { useLayoutEffect, useRef, useState } from "react";
import AgentMessageMarkdown from "../AgentMessageMarkdown";

/** Commentaire de tâche : markdown existant, replié quand le texte dépasse trois lignes. */
export default function TaskNotes({
  source,
  label = "",
}: {
  source: string;
  label?: string;
}) {
  const text = source.trim();
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (expanded) {
      setOverflows(true);
      return;
    }
    setOverflows(node.scrollHeight > node.clientHeight + 1);
  }, [text, expanded]);

  if (!text) return null;

  return (
    <div className="mt-1 text-sm text-slate-700 dark:text-slate-200">
      {label ? <span className="mb-0.5 block text-xs font-semibold text-slate-500">{label}</span> : null}
      <div ref={ref} className={expanded ? "" : "max-h-16 overflow-hidden"}>
        <AgentMessageMarkdown source={text} className="text-sm [&_div]:mb-1" />
      </div>
      {overflows ? (
        <button
          type="button"
          className="mt-1 text-xs font-bold text-violet-800 hover:underline dark:text-violet-200"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Réduire" : "Voir plus"}
        </button>
      ) : null}
    </div>
  );
}
