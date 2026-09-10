"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { EVENT_VISIBILITY_OPTIONS, type EventVisibility } from "../../app/gestion/_shared";
import type { StorefrontParticipant } from "../../lib/storefront";

export default function EventAccessFields({
  visibility,
  onVisibility,
  audienceIds,
  onAudienceIds,
  participants,
}: {
  visibility: EventVisibility;
  onVisibility: (v: EventVisibility) => void;
  audienceIds: string[];
  onAudienceIds: (ids: string[]) => void;
  participants: StorefrontParticipant[];
}) {
  const [q, setQ] = useState("");
  const active = useMemo(
    () => (participants || []).filter((p) => (p.status || "active") === "active"),
    [participants],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return active;
    return active.filter(
      (p) =>
        (p.display_name || "").toLowerCase().includes(needle) ||
        (p.email || "").toLowerCase().includes(needle),
    );
  }, [active, q]);

  function toggle(id: string) {
    if (audienceIds.includes(id)) {
      onAudienceIds(audienceIds.filter((x) => x !== id));
    } else {
      onAudienceIds([...audienceIds, id]);
    }
  }

  return (
    <div className="sm:col-span-2 space-y-3 rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
      <p className="text-sm font-bold text-slate-900">Qui y a accès ?</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {EVENT_VISIBILITY_OPTIONS.map((opt) => (
          <label
            key={opt.id}
            className={`flex cursor-pointer items-start gap-2 rounded-xl border bg-white px-3 py-2.5 text-sm ${
              visibility === opt.id ? "border-emerald-500 ring-1 ring-emerald-200" : "border-slate-200"
            }`}
          >
            <input
              type="radio"
              className="mt-0.5"
              name="event-visibility"
              checked={visibility === opt.id}
              onChange={() => onVisibility(opt.id)}
            />
            <span>
              <span className="block font-semibold text-slate-900">{opt.label}</span>
              <span className="block text-xs text-slate-600">{opt.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {visibility === "selected" ? (
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-sm font-semibold text-slate-800">Participants choisis</p>
          <p className="mt-1 text-xs text-slate-500">
            Ce n’est pas la liste CRM. Uniquement les comptes participants <strong>actifs</strong> (inscription validée ou invitation acceptée).
          </p>
          <input
            className="input-field mt-2 w-full"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un participant…"
          />
          {active.length === 0 ? (
            <p className="mt-2 text-sm text-amber-800">
              Aucun participant actif.{" "}
              <Link href="/administration/vitrine" className="font-semibold underline">
                Inviter ou valider depuis la vitrine
              </Link>
              .
            </p>
          ) : (
            <ul className="mt-2 max-h-48 overflow-y-auto divide-y divide-slate-100">
              {filtered.map((p) => (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-2 py-1.5 text-sm">
                    <input type="checkbox" checked={audienceIds.includes(p.id)} onChange={() => toggle(p.id)} />
                    <span className="font-medium text-slate-900">{p.display_name || p.email}</span>
                    {p.display_name ? <span className="text-xs text-slate-500">{p.email}</span> : null}
                  </label>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs font-semibold text-slate-600">{audienceIds.length} participant(s) sélectionné(s)</p>
        </div>
      ) : null}
    </div>
  );
}
