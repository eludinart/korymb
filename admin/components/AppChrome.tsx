"use client";

import AppNav from "./AppNav";
import AppStatusZone from "./AppStatusZone";
import RuntimeHeader from "./RuntimeHeader";
import NotificationBell from "./director/NotificationBell";
import AuthBar from "./AuthBar";
import CommandPalette from "./CommandPalette";
import { useExecutiveMode } from "../lib/executiveMode";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const { executiveMode, showTechnical, toggleTechnical } = useExecutiveMode();

  return (
    <>
      <CommandPalette />
      <header className="app-header-bar">
        <div className="flex w-full min-w-0 items-center justify-between gap-2 px-3 py-3 sm:gap-3 sm:px-5 lg:px-6 xl:px-8">
          <div className="min-w-0 flex-1">
            <p className="app-brand">Korymb</p>
            <RuntimeHeader showInfrastructure={showTechnical} />
            {executiveMode ? (
              <p className="text-xs font-semibold text-slate-500">
                Cockpit dirigeant ·{" "}
                <button
                  type="button"
                  onClick={toggleTechnical}
                  className="font-bold text-violet-700 underline-offset-2 hover:underline"
                >
                  Afficher le technique
                </button>
                <span className="mx-1 text-slate-300">·</span>
                <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">Ctrl+K</kbd>
              </p>
            ) : null}
          </div>
          <AuthBar />
          <NotificationBell />
          <AppNav />
        </div>
        <div className="app-status-strip">
          <div className="w-full min-w-0 px-3 py-2.5 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
            <AppStatusZone executiveMode={executiveMode} />
          </div>
        </div>
      </header>
      <main className="w-full min-w-0 px-3 py-4 pb-safe sm:px-5 sm:py-6 lg:px-6 lg:py-8 xl:px-8">{children}</main>
    </>
  );
}
