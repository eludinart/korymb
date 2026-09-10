export const PRACTICE_ACCENTS = {
  emerald: {
    label: "Émeraude",
    accent: "#047857",
    hover: "#065f46",
    soft: "#d1fae5",
    ink: "#064e3b",
  },
  terracotta: {
    label: "Terre",
    accent: "#9a3412",
    hover: "#7c2d12",
    soft: "#ffedd5",
    ink: "#7c2d12",
  },
  violet: {
    label: "Violet",
    accent: "#6d28d9",
    hover: "#5b21b6",
    soft: "#ede9fe",
    ink: "#4c1d95",
  },
  ocean: {
    label: "Océan",
    accent: "#0e7490",
    hover: "#155e75",
    soft: "#cffafe",
    ink: "#164e63",
  },
} as const;

export const PRACTICE_PAPERS = {
  warm: { label: "Papier chaud", paper: "#faf6f0", surface: "#fffdf9" },
  cool: { label: "Papier froid", paper: "#f8fafc", surface: "#ffffff" },
  ink: { label: "Encre douce", paper: "#f3eee4", surface: "#fffaf3" },
} as const;

export const PRACTICE_TYPEFACES = {
  sans: {
    label: "Humaniste",
    heading: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
  serif: {
    label: "Éditorial",
    heading: 'Georgia, "Palatino Linotype", Palatino, "Times New Roman", serif',
  },
} as const;

export const OFFER_KIND_LABELS: Record<string, string> = {
  atelier: "Atelier",
  visio: "Visio",
  module: "Module",
};

export type PracticeAccent = keyof typeof PRACTICE_ACCENTS;
export type PracticePaper = keyof typeof PRACTICE_PAPERS;
export type PracticeTypeface = keyof typeof PRACTICE_TYPEFACES;

export type PracticeIdentity = {
  name?: string;
  slug?: string;
  tagline?: string;
  intro?: string;
  location?: string;
  contact_email?: string;
  contact_url?: string;
  accent?: string;
  paper?: string;
  typeface?: string;
  has_logo?: boolean;
  has_cover?: boolean;
  logo_url?: string;
  cover_url?: string;
};

export function practiceAccent(value?: string | null): PracticeAccent {
  return value && value in PRACTICE_ACCENTS ? (value as PracticeAccent) : "emerald";
}

export function practicePaper(value?: string | null): PracticePaper {
  return value && value in PRACTICE_PAPERS ? (value as PracticePaper) : "warm";
}

export function practiceTypeface(value?: string | null): PracticeTypeface {
  return value && value in PRACTICE_TYPEFACES ? (value as PracticeTypeface) : "sans";
}

export function practiceThemeVars(identity: PracticeIdentity): Record<string, string> {
  const accent = PRACTICE_ACCENTS[practiceAccent(identity.accent)];
  const paper = PRACTICE_PAPERS[practicePaper(identity.paper)];
  const typeface = PRACTICE_TYPEFACES[practiceTypeface(identity.typeface)];
  return {
    "--practice-accent": accent.accent,
    "--practice-accent-hover": accent.hover,
    "--practice-soft": accent.soft,
    "--practice-ink": accent.ink,
    "--practice-paper": paper.paper,
    "--practice-surface": paper.surface,
    "--practice-heading-font": typeface.heading,
  };
}
