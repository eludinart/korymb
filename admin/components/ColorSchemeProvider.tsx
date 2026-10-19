"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyColorScheme,
  loadColorScheme,
  persistColorScheme,
  type ColorScheme,
} from "../lib/colorScheme";

type ColorSchemeContextValue = {
  scheme: ColorScheme;
  isDark: boolean;
  setScheme: (scheme: ColorScheme) => void;
  toggleScheme: () => void;
  ready: boolean;
};

const ColorSchemeContext = createContext<ColorSchemeContextValue | null>(null);

/** Une seule source de vérité Clair / Nocturne. */
export function ColorSchemeProvider({ children }: { children: ReactNode }) {
  const [scheme, setSchemeState] = useState<ColorScheme>("light");
  const [ready, setReady] = useState(false);
  const skipPersistOnce = useRef(true);

  useEffect(() => {
    const resolved = loadColorScheme();
    applyColorScheme(resolved);
    setSchemeState(resolved);
    setReady(true);
  }, []);

  // Applique le thème dès que `scheme` change (hors effets dans setState — cassés par Strict Mode).
  useEffect(() => {
    if (!ready) return;
    applyColorScheme(scheme);
    if (skipPersistOnce.current) {
      skipPersistOnce.current = false;
      return;
    }
    persistColorScheme(scheme);
  }, [scheme, ready]);

  const setScheme = useCallback((next: ColorScheme) => {
    setSchemeState(next);
  }, []);

  const toggleScheme = useCallback(() => {
    setSchemeState((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const value = useMemo(
    () => ({
      scheme,
      isDark: scheme === "dark",
      setScheme,
      toggleScheme,
      ready,
    }),
    [scheme, setScheme, toggleScheme, ready],
  );

  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>;
}

export function useColorSchemeContext(): ColorSchemeContextValue {
  const ctx = useContext(ColorSchemeContext);
  if (!ctx) {
    throw new Error("useColorSchemeContext doit être sous ColorSchemeProvider");
  }
  return ctx;
}
