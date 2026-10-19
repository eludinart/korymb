"use client";

import { useCallback, useEffect, useState } from "react";

export type ColorScheme = "light" | "dark";

const STORAGE_KEY = "korymb-color-scheme-v1";

export const COLOR_SCHEME_LABELS: Record<ColorScheme, string> = {
  light: "Clair",
  dark: "Nocturne",
};

export function normalizeColorScheme(raw: string | null | undefined): ColorScheme {
  return raw === "dark" ? "dark" : "light";
}

export function applyColorScheme(scheme: ColorScheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const dark = scheme === "dark";

  if (dark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.dataset.colorScheme = scheme;
  try {
    root.style.colorScheme = scheme;
  } catch {
    /* ignore */
  }
}

export function loadColorScheme(): ColorScheme {
  if (typeof window === "undefined") return "light";
  try {
    return normalizeColorScheme(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "light";
  }
}

export function persistColorScheme(scheme: ColorScheme) {
  try {
    localStorage.setItem(STORAGE_KEY, scheme);
  } catch {
    /* ignore */
  }
}

/** À injecter dans <head> pour éviter un flash. */
export const COLOR_SCHEME_BOOT_SCRIPT = `(function(){try{var s=localStorage.getItem("${STORAGE_KEY}");var dark=s==="dark";var r=document.documentElement;if(dark)r.classList.add("dark");else r.classList.remove("dark");r.dataset.colorScheme=dark?"dark":"light";r.style.colorScheme=dark?"dark":"light"}catch(e){}})();`;

export function useColorScheme(): {
  scheme: ColorScheme;
  isDark: boolean;
  setScheme: (scheme: ColorScheme) => void;
  toggleScheme: () => void;
} {
  const [scheme, setSchemeState] = useState<ColorScheme>("light");

  useEffect(() => {
    const next = loadColorScheme();
    setSchemeState(next);
    applyColorScheme(next);
  }, []);

  useEffect(() => {
    applyColorScheme(scheme);
  }, [scheme]);

  const setScheme = useCallback((next: ColorScheme) => {
    persistColorScheme(next);
    setSchemeState(next);
  }, []);

  const toggleScheme = useCallback(() => {
    setSchemeState((prev) => {
      const next: ColorScheme = prev === "dark" ? "light" : "dark";
      persistColorScheme(next);
      return next;
    });
  }, []);

  return { scheme, isDark: scheme === "dark", setScheme, toggleScheme };
}
