"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertBox } from "../ui/PageChrome";
import { businessApi } from "../../lib/business";

export const SCIENCE_FACT_LABELS: Record<string, string> = {
  brand: "Marque",
  tagline: "Formule",
  location: "Lieu",
  offers: "Offres",
  activity: "Activité",
  tone: "Ton",
  icp: "Public",
  companies: "Sociétés",
  boats: "Bateaux",
  org: "Organisation",
  assets: "Atouts",
  contact_email: "Contact",
  intro: "Intro",
};

const STANDARD_KEYS = [
  "brand",
  "tagline",
  "location",
  "offers",
  "activity",
  "tone",
  "icp",
  "companies",
  "boats",
  "org",
] as const;

/** Affichage lecture : listes en « · », jamais de dump JSON/dict. */
export function formatFactValue(value: unknown): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean).join(" · ");
  }
  if (typeof value === "object") {
    const parts = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => {
        const label = String(k || "").trim();
        const text = String(v || "").trim();
        if (label && text) return `${label} : ${text}`;
        return label || text;
      })
      .filter(Boolean);
    return parts.join(" · ");
  }
  const text = String(value).trim();
  if (text.startsWith("{") && text.endsWith("}") && (text.includes("':") || text.includes('":'))) {
    try {
      const parsed = JSON.parse(text.replace(/'/g, '"')) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return formatFactValue(parsed);
      }
    } catch {
      /* garder le texte */
    }
  }
  return text;
}

function valueToField(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean).join("\n");
  }
  return formatFactValue(value);
}

function fieldToValue(raw: string, asList: boolean): string | string[] {
  const text = raw.trim();
  if (!asList) return text;
  const lines = text
    .split(/\n|·|,/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.length > 1 ? lines : text;
}

const LIST_KEYS = new Set(["offers", "companies", "boats", "assets"]);

type Props = {
  facts: Record<string, string | string[]>;
  open: boolean;
  onClose: () => void;
};

export function ScienceIdentityEditor({ facts, open, onClose }: Props) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  const [customLabels, setCustomLabels] = useState<Record<string, string>>({});
  const [newLabel, setNewLabel] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const existingKeys = useMemo(() => {
    const fromFacts = Object.keys(facts || {}).filter((k) => k !== "updated_at");
    const ordered = [
      ...STANDARD_KEYS.filter((k) => fromFacts.includes(k) || drafts[k] !== undefined),
      ...fromFacts.filter((k) => !(STANDARD_KEYS as readonly string[]).includes(k)),
      ...extraKeys.filter((k) => !fromFacts.includes(k)),
    ];
    // Toujours proposer les sections standard vides pour faciliter l’édition.
    for (const k of STANDARD_KEYS) {
      if (!ordered.includes(k)) ordered.push(k);
    }
    return [...new Set(ordered)];
  }, [facts, drafts, extraKeys]);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(facts || {})) {
      if (k === "updated_at") continue;
      next[k] = valueToField(v);
    }
    for (const k of STANDARD_KEYS) {
      if (next[k] === undefined) next[k] = "";
    }
    setDrafts(next);
    setExtraKeys([]);
    setCustomLabels({});
    setNewLabel("");
    setMsg("");
    setErr("");
  }, [open, facts]);

  const invalidate = async (overview?: unknown) => {
    if (overview) {
      qc.setQueryData(["science-overview"], overview);
    }
    await qc.invalidateQueries({ queryKey: ["science-overview"] });
  };

  const saveOne = useMutation({
    mutationFn: async (key: string) => {
      const raw = drafts[key] ?? "";
      const value = fieldToValue(raw, LIST_KEYS.has(key));
      if (!String(Array.isArray(value) ? value.join("") : value).trim()) {
        throw new Error("Saisissez une valeur avant d’enregistrer.");
      }
      return businessApi.putScienceFacts({ [key]: value });
    },
    onMutate: (key) => {
      setBusyKey(key);
      setErr("");
      setMsg("");
    },
    onSuccess: async (data) => {
      setMsg("Section enregistrée.");
      await invalidate(data.overview);
    },
    onError: (e: Error) => setErr(e.message || "Échec de l’enregistrement."),
    onSettled: () => setBusyKey(null),
  });

  const removeOne = useMutation({
    mutationFn: (key: string) => businessApi.deleteScienceFact(key),
    onMutate: (key) => {
      setBusyKey(key);
      setErr("");
      setMsg("");
    },
    onSuccess: async (data, key) => {
      setDrafts((d) => {
        const next = { ...d };
        delete next[key];
        return next;
      });
      setExtraKeys((keys) => keys.filter((k) => k !== key));
      setMsg("Section supprimée.");
      await invalidate(data.overview);
    },
    onError: (e: Error) => setErr(e.message || "Échec de la suppression."),
    onSettled: () => setBusyKey(null),
  });

  if (!open) return null;

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-violet-950 dark:text-violet-100">
          Modifier l’identité — une section à la fois
        </p>
        <button type="button" className="btn-secondary text-xs" onClick={onClose}>
          Fermer
        </button>
      </div>

      {err ? (
        <AlertBox tone="error" title="Erreur">
          {err}
        </AlertBox>
      ) : null}
      {msg ? <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">{msg}</p> : null}

      <ul className="space-y-3">
        {existingKeys.map((key) => {
          const label = customLabels[key] || SCIENCE_FACT_LABELS[key] || key.replace(/_/g, " ");
          const hasStored = Object.prototype.hasOwnProperty.call(facts || {}, key);
          const busy = busyKey === key;
          return (
            <li
              key={key}
              className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900"
            >
              <label className="block text-[11px] font-bold uppercase tracking-wide text-slate-500" htmlFor={`sci-fact-${key}`}>
                {label}
              </label>
              <textarea
                id={`sci-fact-${key}`}
                className="input-field mt-1 min-h-[4.5rem] text-sm"
                value={drafts[key] ?? ""}
                onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                placeholder={
                  LIST_KEYS.has(key)
                    ? "Une entrée par ligne (ou séparées par ·)"
                    : "Texte court"
                }
                maxLength={2000}
                disabled={busy}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={busy || !(drafts[key] || "").trim()}
                  onClick={() => saveOne.mutate(key)}
                >
                  {busy && saveOne.isPending ? "…" : "Enregistrer"}
                </button>
                {hasStored ? (
                  <button
                    type="button"
                    className="btn-secondary text-xs text-red-700 dark:text-red-300"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Supprimer la section « ${label} » ?`)) {
                        removeOne.mutate(key);
                      }
                    }}
                  >
                    Supprimer
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="rounded-xl border border-dashed border-violet-300 bg-white/80 p-3 dark:border-violet-700 dark:bg-slate-900/60">
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Ajouter une section</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            className="input-field max-w-xs text-sm"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Titre (ex. Vision 2026)"
            maxLength={40}
            aria-label="Titre de la nouvelle section"
          />
          <button
            type="button"
            className="btn-secondary text-xs"
            disabled={!newLabel.trim()}
            onClick={() => {
              const label = newLabel.trim();
              const slug = label
                .toLowerCase()
                .normalize("NFD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/[^a-z0-9]+/g, "_")
                .replace(/^_|_$/g, "")
                .slice(0, 40) || "section";
              const key = /^[0-9]/.test(slug) ? `s_${slug}` : slug;
              if (!existingKeys.includes(key)) {
                setExtraKeys((k) => [...k, key]);
                setDrafts((d) => ({ ...d, [key]: "" }));
                setCustomLabels((m) => ({ ...m, [key]: label }));
              }
              setNewLabel("");
            }}
          >
            Ajouter
          </button>
        </div>
      </div>
    </div>
  );
}

type PersonProps = {
  open: boolean;
  onClose: () => void;
};

export function SciencePersonEditor({ open, onClose }: PersonProps) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setRole("");
    setErr("");
    setMsg("");
  }, [open]);

  const save = useMutation({
    mutationFn: () =>
      businessApi.createScienceEntity({
        name: name.trim(),
        entity_type: "person",
        attributes: role.trim() ? { role: role.trim() } : {},
      }),
    onSuccess: async (data) => {
      setMsg("Fiche enregistrée.");
      if (data.overview) qc.setQueryData(["science-overview"], data.overview);
      await qc.invalidateQueries({ queryKey: ["science-overview"] });
      setName("");
      setRole("");
    },
    onError: (e: Error) => setErr(e.message || "Échec."),
  });

  if (!open) return null;

  return (
    <div className="mt-3 space-y-3 rounded-2xl border border-violet-200 bg-violet-50/50 p-3 dark:border-violet-800 dark:bg-violet-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-bold text-violet-950 dark:text-violet-100">Préciser une personne</p>
        <button type="button" className="btn-secondary text-xs" onClick={onClose}>
          Fermer
        </button>
      </div>
      {err ? (
        <AlertBox tone="error" title="Erreur">
          {err}
        </AlertBox>
      ) : null}
      {msg ? <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-200">{msg}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        <input
          className="input-field text-sm"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nom"
          maxLength={200}
          aria-label="Nom"
        />
        <input
          className="input-field text-sm"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          placeholder="Rôle (ex. Dirigeant)"
          maxLength={200}
          aria-label="Rôle"
        />
      </div>
      <button
        type="button"
        className="btn-primary text-xs"
        disabled={!name.trim() || save.isPending}
        onClick={() => {
          setErr("");
          setMsg("");
          save.mutate();
        }}
      >
        {save.isPending ? "…" : "Enregistrer"}
      </button>
    </div>
  );
}
