"use client";

import type { HealthTone } from "../lib/healthTone";

export type { HealthTone };

export function healthDotRingClass(tone: HealthTone): string {
  switch (tone) {
    case "ok":
      return "bg-emerald-500 ring-emerald-500/30";
    case "warn":
      return "bg-amber-500 ring-amber-500/35";
    case "bad":
      return "bg-red-500 ring-red-500/35";
    default:
      return "bg-slate-300 ring-slate-400/25";
  }
}

type Props = {
  tone: HealthTone;
  /** Infobulle + accessibilité */
  label?: string;
  size?: "sm" | "md";
  className?: string;
};

export default function HealthDot({ tone, label, size = "sm", className = "" }: Props) {
  const sz = size === "md" ? "h-2.5 w-2.5" : "h-2 w-2";
  return (
    <span
      className={`inline-flex shrink-0 rounded-full ring-2 ${sz} ${healthDotRingClass(tone)} ${className}`}
      title={label}
      role="img"
      aria-label={label || `État : ${tone}`}
    />
  );
}
