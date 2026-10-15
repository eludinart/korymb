"use client";

import { useLayoutEffect } from "react";

function isAndroidDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  if (/Android/i.test(navigator.userAgent || "")) return true;
  const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  return platform === "Android";
}

/**
 * Synchronise --app-visual-height avec visualViewport.
 * iOS : 100dvh ne se réduit souvent pas quand le clavier s'ouvre.
 * Android : ne pas figer la page. Gboard annule la saisie vocale si le champ
 * bouge pendant que le clavier est ouvert (position:fixed + hauteur visualViewport).
 */
export function useSyncVisualViewportHeight(enabled = true) {
  useLayoutEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const root = document.documentElement;
    const android = isAndroidDevice();
    root.classList.toggle("chat-android", android);
    const sync = () => {
      const vv = window.visualViewport;
      const height = Math.round(vv?.height ?? window.innerHeight);
      const offsetTop = Math.round(vv?.offsetTop ?? 0);
      if (!android) {
        root.style.setProperty("--app-visual-height", `${height}px`);
        root.style.setProperty("--app-visual-offset-top", `${offsetTop}px`);
      }
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
      root.classList.remove("chat-android");
      delete root.dataset.keyboardOpen;
    };
  }, [enabled]);
}
