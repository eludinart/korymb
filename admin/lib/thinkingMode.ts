/** Modes de pensée Mode Cerveau — préférences locales + libellés. */

export type ThinkingModeId = "auto" | "scientifique" | "artiste" | "philosophe" | "enfant";

export type ThinkingModeOption = { id: ThinkingModeId; label: string };

export const THINKING_MODES: ThinkingModeOption[] = [
  { id: "auto", label: "Auto" },
  { id: "scientifique", label: "Scientifique" },
  { id: "artiste", label: "Artiste" },
  { id: "philosophe", label: "Philosophe" },
  { id: "enfant", label: "Curiosité" },
];

const LS_KEY = "korymb-thinking-mode";

export function normalizeThinkingMode(raw: unknown): ThinkingModeId {
  const v = String(raw || "auto").trim().toLowerCase();
  return THINKING_MODES.some((m) => m.id === v) ? (v as ThinkingModeId) : "auto";
}

export function loadThinkingMode(): ThinkingModeId {
  if (typeof window === "undefined") return "auto";
  try {
    return normalizeThinkingMode(localStorage.getItem(LS_KEY));
  } catch {
    return "auto";
  }
}

export function saveThinkingMode(mode: ThinkingModeId) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LS_KEY, normalizeThinkingMode(mode));
  } catch {
    /* ignore */
  }
}

export function thinkingModeLabel(mode: ThinkingModeId | string | null | undefined): string {
  const id = normalizeThinkingMode(mode);
  return THINKING_MODES.find((m) => m.id === id)?.label || "Auto";
}
