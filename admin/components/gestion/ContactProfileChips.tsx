"use client";

import {
  CONTACT_PROFILE_DEFS,
  tagsIncludeProfile,
  toggleProfileTag,
} from "../../lib/contactProfiles";

type Props = {
  tags: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
};

/** Cases à cocher pour poser un profil métier (écrit dans les tags). */
export default function ContactProfileChips({ tags, onChange, disabled }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {CONTACT_PROFILE_DEFS.map((p) => {
        const active = tagsIncludeProfile(tags, p.key);
        return (
          <button
            key={p.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(toggleProfileTag(tags, p.key))}
            className={
              active
                ? "touch-target rounded-full border border-emerald-600 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900"
                : "touch-target rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-slate-300"
            }
            aria-pressed={active}
          >
            {p.label}
          </button>
        );
      })}
    </div>
  );
}
