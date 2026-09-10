"use client";

import HealthDot from "./HealthDot";
import type { HealthTone } from "../lib/healthTone";
import type { RepairGuide } from "../lib/integrationRepairGuide";
import { statusBadgeClass } from "../lib/integrationRepairGuide";

export function ConnectorStatusBadge({ tone, label }: { tone: HealthTone; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(tone)}`}
    >
      {label}
    </span>
  );
}

export function ConnectorRepairPanel({
  guide,
  compact = false,
}: {
  guide: RepairGuide | null;
  compact?: boolean;
}) {
  if (!guide) return null;
  return (
    <div
      className={`rounded-xl border border-amber-200 bg-amber-50/90 text-amber-950 ${
        compact ? "mt-2 px-2.5 py-2" : "mt-3 px-3 py-3"
      }`}
    >
      <p className={`font-semibold ${compact ? "text-[11px]" : "text-xs"}`}>Pourquoi ce statut</p>
      <p className={`mt-1 leading-snug ${compact ? "text-[11px]" : "text-sm"}`}>{guide.reason}</p>
      <p className={`mt-2 font-semibold ${compact ? "text-[11px]" : "text-xs"}`}>Procédure</p>
      <ol className={`mt-1 list-decimal space-y-1 pl-4 leading-snug ${compact ? "text-[11px]" : "text-sm"}`}>
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {guide.externalHref ? (
        <a
          href={guide.externalHref}
          target="_blank"
          rel="noreferrer"
          className={`mt-2 inline-flex font-semibold text-violet-800 underline hover:text-violet-950 ${
            compact ? "text-[11px]" : "text-xs"
          }`}
        >
          {guide.externalLabel || "Documentation"}
        </a>
      ) : null}
    </div>
  );
}

export function ConnectorStatusHeader({
  title,
  tone,
  label,
  subtitle,
  guide,
  showDot = true,
}: {
  title: string;
  tone: HealthTone;
  label: string;
  subtitle?: string;
  guide?: RepairGuide | null;
  showDot?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        {showDot ? <HealthDot tone={tone} label={`${title} — ${label}`} /> : null}
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <ConnectorStatusBadge tone={tone} label={label} />
      </div>
      {subtitle ? <p className="mt-0.5 text-[11px] text-slate-500">{subtitle}</p> : null}
      {guide ? <ConnectorRepairPanel guide={guide} compact /> : null}
    </div>
  );
}
