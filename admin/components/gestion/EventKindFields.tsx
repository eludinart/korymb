"use client";

import {
  EVENT_NATURE_HINT,
  EVENT_NATURE_LABELS,
  EVENT_TYPE_HINT,
  EVENT_TYPE_LABELS,
  coerceEventTypeForNature,
  eventTypeOptionsForNature,
} from "../../app/gestion/_shared";

type Props = {
  nature: string;
  eventType: string;
  onNature: (nature: string) => void;
  onEventType: (eventType: string) => void;
  onClearResource?: () => void;
};

export default function EventKindFields({ nature, eventType, onNature, onEventType, onClearResource }: Props) {
  const typeKeys = eventTypeOptionsForNature(nature);
  if (eventType && !typeKeys.includes(eventType)) typeKeys.unshift(eventType);

  return (
    <>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">De quoi s’agit-il ?</span>
        <select
          className="input-field mt-1 w-full"
          value={nature}
          onChange={(e) => {
            const next = e.target.value;
            onNature(next);
            onEventType(coerceEventTypeForNature(next, eventType));
            if (next !== "matiere") onClearResource?.();
          }}
        >
          {Object.entries(EVENT_NATURE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-500">{EVENT_NATURE_HINT}</span>
      </label>
      <label className="block text-sm">
        <span className="font-medium text-slate-700">Précisez</span>
        <select
          className="input-field mt-1 w-full"
          value={eventType}
          onChange={(e) => {
            const v = e.target.value;
            onEventType(v);
            if (v === "ressource" || v === "jalon") onNature("matiere");
            else if (v !== "autre") {
              onNature("presence");
              onClearResource?.();
            }
          }}
        >
          {typeKeys.map((k) => (
            <option key={k} value={k}>
              {EVENT_TYPE_LABELS[k] || k}
            </option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-slate-500">{EVENT_TYPE_HINT}</span>
      </label>
    </>
  );
}
