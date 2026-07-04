"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const LS_KEY = "korymb_show_technical";

/** Routes où le détail technique (runtime, tokens) reste visible par défaut. */
export function isPilotagePath(pathname: string): boolean {
  return (
    pathname === "/configuration" ||
    pathname.startsWith("/administration")
  );
}

export function readShowTechnical(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

export function writeShowTechnical(value: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, value ? "true" : "false");
  } catch {
    /* ignore */
  }
}

/** Mode dirigeant : masque le chrome technique sauf pilotage ou opt-in explicite. */
export function useExecutiveMode(): {
  executiveMode: boolean;
  showTechnical: boolean;
  setShowTechnical: (v: boolean) => void;
  toggleTechnical: () => void;
} {
  const pathname = usePathname() || "";
  const [showTechnical, setShowTechnicalState] = useState(false);

  useEffect(() => {
    setShowTechnicalState(readShowTechnical());
  }, []);

  const setShowTechnical = useCallback((v: boolean) => {
    writeShowTechnical(v);
    setShowTechnicalState(v);
  }, []);

  const toggleTechnical = useCallback(() => {
    setShowTechnical(!readShowTechnical());
  }, [setShowTechnical]);

  const pilotage = isPilotagePath(pathname);
  const executiveMode = !pilotage && !showTechnical;

  return { executiveMode, showTechnical: pilotage || showTechnical, setShowTechnical, toggleTechnical };
}
