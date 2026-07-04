"use client";

import AgentWorkActivityBar from "./AgentWorkActivityBar";
import GlobalStatusBar from "./GlobalStatusBar";

/** Bandeau header : alertes et activité uniquement (masqué si rien à signaler). */
export default function AppStatusZone() {
  return (
    <div className="w-full min-w-0 space-y-2.5">
      <GlobalStatusBar />
      <AgentWorkActivityBar />
    </div>
  );
}
