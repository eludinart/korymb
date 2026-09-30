"use client";

import { useEffect } from "react";

/**
 * Synchronise --app-visual-height avec visualViewport (clavier mobile iOS/Android).
 * 100dvh ne se réduit souvent pas quand le clavier s'ouvre.
 */
export function useSyncVisualViewportHeight(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const root = document.documentElement;
    const sync = () => {
      const vv = window.visualViewport;
      const height = Math.round(vv?.height ?? window.innerHeight);
      const offsetTop = Math.round(vv?.offsetTop ?? 0);
      root.style.setProperty("--app-visual-height", `${height}px`);
      root.style.setProperty("--app-visual-offset-top", `${offsetTop}px`);
      root.dataset.keyboardOpen = height < window.innerHeight - 120 ? "1" : "0";
    };

    sync();
    const vv = window.visualViewport;
    vv?.addEventListener("resize", sync);
    vv?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("orientationchange", sync);
    return () => {
      vv?.removeEventListener("resize", sync);
      vv?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("orientationchange", sync);
      root.style.removeProperty("--app-visual-height");
      root.style.removeProperty("--app-visual-offset-top");
      delete root.dataset.keyboardOpen;
    };
  }, [enabled]);
}
