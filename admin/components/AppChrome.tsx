"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import AppNav from "./AppNav";
import AppStatusZone from "./AppStatusZone";
import HeaderActivityToggle from "./HeaderActivityToggle";
import RuntimeHeader from "./RuntimeHeader";
import NotificationBell from "./director/NotificationBell";
import AuthBar from "./AuthBar";
import CommandPalette from "./CommandPalette";
import OperatorGate from "./OperatorGate";
import DocumentBusyBar from "./DocumentBusyBar";
import ColorSchemeToggle from "./ColorSchemeToggle";
import { useExecutiveMode } from "../lib/executiveMode";
import { useUiMode } from "../lib/uiMode";
import { useSyncVisualViewportHeight } from "../lib/visualViewport";

export default function AppChrome({ children }: { children: React.ReactNode }) {
  const { executiveMode, showTechnical, technicalOptIn, isPilotage, toggleTechnical } = useExecutiveMode();
  const { isEssential, setUiMode, busy: uiBusy } = useUiMode();
  const headerRef = useRef<HTMLElement>(null);
  const pathname = usePathname() || "";
  const isChat = pathname === "/chat";
  const isCarte = pathname === "/carte";
  const isFlushPage = isChat || isCarte;
  const [statusOpen, setStatusOpen] = useState(false);

  useSyncVisualViewportHeight(isChat);

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
    window.visualViewport?.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
    };
  }, [executiveMode, showTechnical, isChat, isFlushPage, statusOpen]);

  useEffect(() => {
    document.documentElement.classList.toggle("chat-immersion", isChat);
    return () => document.documentElement.classList.remove("chat-immersion");
  }, [isChat]);

  return (
    <OperatorGate>
      <CommandPalette />
      <header ref={headerRef} data-pull-refresh="" className={`app-header-bar ${isChat ? "app-header-bar--chat" : ""}`}>
        <div
          className={`flex w-full min-w-0 flex-wrap items-center gap-2 px-3 sm:flex-nowrap sm:gap-3 sm:px-5 lg:px-6 xl:px-8 ${
            isChat ? "py-1 sm:py-3 lg:items-start" : "items-start py-2.5 sm:py-3"
          }`}
        >
          <div className="min-w-0 shrink-0">
            <Link href="/briefing" className="app-brand">
              Korymb
            </Link>
            <p
              className={`mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-violet-700 dark:text-violet-300 ${
                isChat ? "hidden lg:block" : ""
              }`}
            >
              {isEssential ? "Essentiel" : "Activité"}
            </p>
            <RuntimeHeader visible={showTechnical && !isChat} />
            {!isPilotage ? (
              <p className={`mt-0.5 text-xs font-semibold text-slate-500 dark:text-slate-400 ${isChat ? "hidden" : "hidden sm:block"}`}>
                <button
                  type="button"
                  disabled={uiBusy}
                  onClick={() => void setUiMode(isEssential ? "advanced" : "essential")}
                  className="font-bold text-violet-700 underline-offset-2 hover:underline disabled:opacity-60 dark:text-violet-300"
                >
                  {isEssential ? "Passer en Avancé" : "Passer en Essentiel"}
                </button>
                <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                <button
                  type="button"
                  onClick={toggleTechnical}
                  className="font-bold text-slate-600 underline-offset-2 hover:underline dark:text-slate-300"
                >
                  {technicalOptIn ? "Masquer le technique" : "Afficher le technique"}
                </button>
                {executiveMode ? (
                  <>
                    <span className="mx-1 text-slate-300 dark:text-slate-600">·</span>
                    <kbd className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] dark:bg-slate-800">Ctrl+K</kbd>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5 sm:gap-2 lg:items-start">
            <div className={`flex shrink-0 items-center gap-1.5 sm:gap-2 ${isChat ? "lg:flex" : ""}`}>
              <ColorSchemeToggle compact />
              <div className={isChat ? "hidden lg:block" : undefined}>
                <HeaderActivityToggle open={statusOpen} onToggle={() => setStatusOpen((v) => !v)} />
              </div>
              <div className={isChat ? "hidden lg:block" : undefined}>
                <AuthBar />
              </div>
              <NotificationBell />
            </div>
            <div className={isChat ? "hidden lg:block" : undefined}>
              <AppNav />
            </div>
            {isChat ? (
              <Link
                href="/briefing"
                className="flex h-9 items-center rounded-full px-3 text-xs font-semibold text-violet-800 active:bg-violet-50 dark:text-violet-200 dark:active:bg-violet-950 lg:hidden"
              >
                Accueil
              </Link>
            ) : null}
          </div>
        </div>
        {statusOpen ? (
          <div className="app-status-strip">
            <div className="w-full min-w-0 px-3 py-2 sm:px-5 lg:px-6 xl:px-8">
              <AppStatusZone executiveMode={executiveMode} />
            </div>
          </div>
        ) : null}
        <DocumentBusyBar />
      </header>
      <main
        className={
          isChat
            ? "app-flush-main app-chat-main"
            : isCarte
              ? "app-flush-main app-carte-main"
              : "w-full min-w-0 px-3 py-4 pb-safe sm:px-5 sm:py-6 lg:px-6 lg:py-8 xl:px-8"
        }
      >
        {children}
      </main>
    </OperatorGate>
  );
}
