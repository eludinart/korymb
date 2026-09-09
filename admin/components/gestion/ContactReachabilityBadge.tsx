"use client";

import { getContactReachability, reachabilityBadgeClass } from "../../lib/contactReachability";
import type { BizContact } from "../../lib/business";

export default function ContactReachabilityBadge({
  contact,
  compact = false,
}: {
  contact: BizContact;
  compact?: boolean;
}) {
  const r = getContactReachability(contact);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${reachabilityBadgeClass(r.level)}`}
      title={r.missing?.length ? `Manque : ${r.missing.join(", ")}` : r.label}
    >
      <span aria-hidden>{r.level === "complete" ? "●" : r.level === "partial" ? "◐" : "○"}</span>
      {compact ? r.label : `${r.label} · ${r.score}%`}
    </span>
  );
}
