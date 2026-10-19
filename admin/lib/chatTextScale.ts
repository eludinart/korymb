"use client";

import { useCallback, useEffect, useState } from "react";

export type ChatTextScale = "xs" | "sm" | "md" | "lg";

const STORAGE_KEY = "korymb-chat-text-scale-v1";

const SCALE_REM: Record<ChatTextScale, string> = {
  xs: "0.6875rem",
  sm: "0.8125rem",
  md: "0.9375rem",
  lg: "1.0625rem",
};

export const CHAT_TEXT_SCALE_LABELS: Record<ChatTextScale, string> = {
  xs: "Très petit",
  sm: "Petit",
  md: "Normal",
  lg: "Grand",
};

export const CHAT_TEXT_SCALE_ORDER: ChatTextScale[] = ["xs", "sm", "md", "lg"];

export function normalizeChatTextScale(raw: string | null | undefined): ChatTextScale {
  if (raw === "xs" || raw === "sm" || raw === "lg" || raw === "md") return raw;
  return "sm";
}

export function loadChatTextScale(): ChatTextScale {
  if (typeof window === "undefined") return "sm";
  try {
    return normalizeChatTextScale(localStorage.getItem(STORAGE_KEY));
  } catch {
    return "sm";
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
  const [scale, setScaleState] = useState<ChatTextScale>("sm");

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
      const next = CHAT_TEXT_SCALE_ORDER[(i + 1) % CHAT_TEXT_SCALE_ORDER.length] || "sm";
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
