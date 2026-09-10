"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import AppNav from "./AppNav";
import AppStatusZone from "./AppStatusZone";
import RuntimeHeader from "./RuntimeHeader";
import NotificationBell from "./director/NotificationBell";
import AuthBar from "./AuthBar";
import CommandPalette from "./CommandPalette";
import OperatorGate from "./OperatorGate";
import { useExecutiveMode } from "../lib/executiveMode";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const { executiveMode, showTechnical, technicalOptIn, isPilotage, toggleTechnical } = useExecutiveMode();
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const sync = () => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      document.documentElement.style.setProperty("--app-header-offset", `${h}px`);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, [executiveMode, showTechnical]);

  return (
    <OperatorGate>
      <CommandPalette />
      <header ref={headerRef} className="app-header-bar">
        <div className="flex w-full min-w-0 flex-wrap items-start gap-2 px-3 py-2.5 sm:flex-nowrap sm:gap-3 sm:px-5 sm:py-3 lg:px-6 xl:px-8">
          <div className="min-w-0 shrink-0">
            <Link href="/briefing" className="app-brand">
              Korymb
            </Link>
            <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700">Cockpit dirigeant</p>
            <RuntimeHeader visible={showTechnical} />
            {!isPilotage ? (
              <p className="mt-0.5 hidden text-xs font-semibold text-slate-500 sm:block">
                {executiveMode ? "Pilotage du jour · " : null}
                <button
                  type="button"
                  onClick={toggleTechnical}
                  className="font-bold text-violet-700 underline-offset-2 hover:underline"
                >
                  {technicalOptIn ? "Masquer le technique" : "Afficher le technique"}
                </button>
                {executiveMode ? (
                  <>
                    <span className="mx-1 text-slate-300">·</span>
                    <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px]">Ctrl+K</kbd>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 items-start justify-end gap-1.5 sm:gap-2">
            <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
              <AuthBar />
              <NotificationBell />
            </div>
            <AppNav />
          </div>
        </div>
        <div className="app-status-strip">
          <div className="w-full min-w-0 px-3 py-2 sm:px-5 sm:py-2.5 lg:px-6 xl:px-8">
            <AppStatusZone executiveMode={executiveMode} />
          </div>
        </div>
      </header>
      <main className="w-full min-w-0 px-3 py-4 pb-safe sm:px-5 sm:py-6 lg:px-6 lg:py-8 xl:px-8">{children}</main>
    </OperatorGate>
  );
}
