"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "./api";
import type { AuthMeResponse } from "./authSession";

export type UiMode = "essential" | "advanced";

export function normalizeUiMode(raw: string | null | undefined): UiMode {
  return raw === "essential" ? "essential" : "advanced";
}

export async function fetchAuthMe(): Promise<AuthMeResponse | null> {
  const res = await fetch("/api/auth/me", { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as AuthMeResponse;
}

export function useUiMode(): {
  uiMode: UiMode | null;
  isEssential: boolean;
  isAdvanced: boolean;
  /** Menu complet uniquement quand le mode Avancé est confirmé. */
  showAdvanced: boolean;
  loading: boolean;
  role: string;
  canSetUiMode: boolean;
  workspaceSlug: string;
  setUiMode: (mode: UiMode) => Promise<void>;
  busy: boolean;
  error: string;
} {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const me = useQuery({
    queryKey: ["auth-me-ui-mode"],
    queryFn: fetchAuthMe,
    staleTime: 60_000,
  });

  const uiMode: UiMode | null = !me.isFetched
    ? null
    : me.data
      ? normalizeUiMode(me.data.workspace?.ui_mode)
      : null;

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (uiMode) document.documentElement.dataset.uiMode = uiMode;
    else delete document.documentElement.dataset.uiMode;
  }, [uiMode]);

  const setUiMode = useCallback(
    async (mode: UiMode) => {
      setBusy(true);
      setError("");
      try {
        const { res, data } = await requestJson("/auth/workspace/ui-mode", {
          method: "PATCH",
          headers: agentHeaders(),
          body: JSON.stringify({ ui_mode: mode }),
        });
        if (!res.ok) {
          throw new Error(
            typeof data === "object" && data && "detail" in data
              ? String((data as { detail?: string }).detail || "Échec")
              : "Impossible d'enregistrer le mode d'interface.",
          );
        }
        await qc.invalidateQueries({ queryKey: ["auth-me-ui-mode"] });
        await qc.invalidateQueries({ queryKey: ["auth-me-briefing"] });
        await qc.invalidateQueries({ queryKey: ["auth-me-palette"] });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Erreur.");
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [qc],
  );

  return {
    uiMode,
    isEssential: uiMode === "essential",
    isAdvanced: uiMode === "advanced",
    showAdvanced: uiMode === "advanced",
    loading: !me.isFetched,
    role: me.data?.role || "",
    canSetUiMode: me.data?.role === "admin",
    workspaceSlug: me.data?.workspace?.slug || "",
    setUiMode,
    busy,
    error,
  };
}
