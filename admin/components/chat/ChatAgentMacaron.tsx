"use client";

const STYLES: Record<string, string> = {
  assistant: "bg-indigo-600 text-white",
  coordinateur: "bg-violet-600 text-white",
  commercial: "bg-blue-600 text-white",
  community_manager: "bg-pink-600 text-white",
  developpeur: "bg-emerald-600 text-white",
  comptable: "bg-amber-600 text-white",
};

const SHORT: Record<string, string> = {
  assistant: "ASSIST.",
  coordinateur: "CIO",
  commercial: "COM.",
  community_manager: "CM",
  developpeur: "DEV.",
  comptable: "COMPTA.",
};

type Props = {
  agentKey: string;
  label?: string;
};

export default function ChatAgentMacaron({ agentKey, label }: Props) {
  const key = agentKey.trim().toLowerCase();
  const text =
    SHORT[key] ||
    (label ? label.slice(0, 8).toUpperCase() : key.replace(/_/g, " ").slice(0, 10).toUpperCase());
  const style = STYLES[key] || "bg-slate-600 text-white";

  return (
    <span
      className={`inline-flex max-w-[4.5rem] items-center rounded-full px-1.5 py-px text-[8px] font-bold uppercase tracking-wide ${style}`}
      title={label || agentKey}
    >
      <span className="truncate">{text}</span>
    </span>
  );
}
