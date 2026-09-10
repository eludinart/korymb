import type { ReactNode } from "react";

export type MailBucket = "needs_reply" | "awaiting" | "drafts" | "closed" | "all";
export type SuggestTone = "chaleureux" | "concret" | "prudent" | "other";

const FLAG: Record<string, string> = {
  reply: "bg-teal-100 text-teal-950 ring-teal-300",
  wait: "bg-amber-100 text-amber-950 ring-amber-300",
  draft: "bg-violet-100 text-violet-950 ring-violet-300",
  closed: "bg-slate-200 text-slate-800 ring-slate-300",
  gen: "bg-violet-200 text-violet-950 ring-violet-400",
  ready: "bg-emerald-100 text-emerald-950 ring-emerald-300",
  chosen: "bg-violet-700 text-white ring-violet-800",
  inbox: "bg-orange-100 text-orange-950 ring-orange-300",
  fallback: "bg-amber-100 text-amber-950 ring-amber-400",
  llm: "bg-emerald-100 text-emerald-950 ring-emerald-400",
  new: "bg-slate-100 text-slate-800 ring-slate-300",
  chaleureux: "bg-rose-100 text-rose-950 ring-rose-300",
  concret: "bg-sky-100 text-sky-950 ring-sky-300",
  prudent: "bg-amber-100 text-amber-950 ring-amber-300",
};

export function MailFlag({
  tone,
  pulse,
  children,
}: {
  tone: keyof typeof FLAG;
  pulse?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide ring-2 ${FLAG[tone] || FLAG.new} ${pulse ? "animate-pulse" : ""}`}
    >
      {children}
    </span>
  );
}

export function bucketFlag(bucket: string | undefined): { tone: keyof typeof FLAG; label: string } {
  if (bucket === "needs_reply") return { tone: "reply", label: "À répondre" };
  if (bucket === "closed") return { tone: "closed", label: "Clos" };
  if (bucket === "drafts") return { tone: "draft", label: "Brouillon" };
  return { tone: "wait", label: "En attente" };
}

export function suggestTone(label: string): SuggestTone {
  const raw = (label || "").toLowerCase();
  if (raw.includes("chaleureux")) return "chaleureux";
  if (raw.includes("concret")) return "concret";
  if (raw.includes("prudent")) return "prudent";
  return "other";
}

export function suggestCardClass(label: string, active: boolean): string {
  const tone = suggestTone(label);
  const idle =
    tone === "chaleureux"
      ? "border-rose-200 bg-rose-50/80 hover:border-rose-400"
      : tone === "concret"
        ? "border-sky-200 bg-sky-50/80 hover:border-sky-400"
        : tone === "prudent"
          ? "border-amber-200 bg-amber-50/80 hover:border-amber-400"
          : "border-slate-200 bg-slate-50 hover:border-violet-300";
  const on =
    tone === "chaleureux"
      ? "border-2 border-rose-600 bg-rose-50 ring-2 ring-rose-200"
      : tone === "concret"
        ? "border-2 border-sky-600 bg-sky-50 ring-2 ring-sky-200"
        : tone === "prudent"
          ? "border-2 border-amber-600 bg-amber-50 ring-2 ring-amber-200"
          : "border-2 border-violet-600 bg-violet-50 ring-2 ring-violet-200";
  return `w-full rounded-xl p-4 text-left ${active ? on : `border ${idle}`}`;
}

export function threadListAccent(bucket: string | undefined): string {
  if (bucket === "needs_reply") return "border-l-4 border-l-teal-500";
  if (bucket === "closed") return "border-l-4 border-l-slate-400";
  if (bucket === "drafts") return "border-l-4 border-l-violet-500";
  return "border-l-4 border-l-amber-400";
}

export const SUGGEST_SKELETONS = [
  { id: "sk-chaleureux", label: "Chaleureux", hint: "Accueil et dialogue" },
  { id: "sk-concret", label: "Concret", hint: "Prochaine étape claire" },
  { id: "sk-prudent", label: "Prudent", hint: "Sans forcer" },
] as const;
