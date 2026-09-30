"use client";

import { useCallback, useEffect, useState } from "react";

export type ChatTextScale = "sm" | "md" | "lg";

const STORAGE_KEY = "korymb-chat-text-scale-v1";

const SCALE_REM: Record<ChatTextScale, string> = {
  sm: "0.875rem",
  md: "1rem",
  lg: "1.125rem",
};

export const CHAT_TEXT_SCALE_LABELS: Record<ChatTextScale, string> = {
  sm: "Petit",
  md: "Normal",
  lg: "Grand",
};

export const CHAT_TEXT_SCALE_ORDER: ChatTextScale[] = ["sm", "md", "lg"];

export function normalizeChatTextScale(raw: string | null | undefined): ChatTextScale {
  if (raw === "sm" || raw === "lg" || raw === "md") return raw;
  return "md";
}

export function loadChatTextScale(): ChatTextScale {
  if (typeof window === "undefined") return "md";
  try {
    return normalizeChatTextScale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "md";
  }
}

export function applyChatTextScale(scale: ChatTextScale) {
  if (typeof document === "undefined") return;
  document.documentElement.style.setProperty("--chat-text-size", SCALE_REM[scale]);
  document.documentElement.dataset.chatTextScale = scale;
}

export function useChatTextScale(): {
  scale: ChatTextScale;
  setScale: (scale: ChatTextScale) => void;
  cycleScale: () => void;
} {
  const [scale, setScaleState] = useState<ChatTextScale>("md");

  useEffect(() => {
    const next = loadChatTextScale();
    setScaleState(next);
    applyChatTextScale(next);
  }, []);

  const setScale = useCallback((next: ChatTextScale) => {
    setScaleState(next);
    applyChatTextScale(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const cycleScale = useCallback(() => {
    setScaleState((prev) => {
      const i = CHAT_TEXT_SCALE_ORDER.indexOf(prev);
      const next = CHAT_TEXT_SCALE_ORDER[(i + 1) % CHAT_TEXT_SCALE_ORDER.length] || "md";
      applyChatTextScale(next);
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { scale, setScale, cycleScale };
}
