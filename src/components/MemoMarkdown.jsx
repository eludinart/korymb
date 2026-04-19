import React, { useMemo } from "react";
import { marked } from "marked";

/**
 * Rendu markdown stable : pas de mise à jour du DOM tant que `content` est identique.
 * Évite clignotement et perte de sélection quand un parent se re-rend souvent (ex. polling jobs).
 */
export const MemoMarkdown = React.memo(function MemoMarkdown({
  content,
  className = "prose prose-sm max-w-none prose-slate",
}) {
  const html = useMemo(() => {
    try {
      return String(marked.parse(typeof content === "string" ? content : ""));
    } catch {
      return "";
    }
  }, [content]);
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});
