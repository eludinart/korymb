"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { agentHeaders, requestJson } from "../../../lib/api";

type BehaviorSetting = {
  setting_key: string;
  value: unknown;
  updated_at?: string | null;
  category: string;
  type: string;
  label: string;
  description?: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  orchestration: "Orchestration CIO",
  fallbacks: "Filets de sécurité",
  synthesis: "Synthèse",
  misc: "Divers",
};

export default function BehaviorSettingsPage() {
  const qc = useQueryClient();
  const [selectedCategory, setSelectedCategory] = useState<string>("orchestration");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [draft, setDraft] = useState<string>("");
  const [mobilePane, setMobilePane] = useState<"browse" | "edit">("browse");

  const listQuery = useQuery({
    queryKey: ["behavior-settings"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/behavior-settings", { headers: agentHeaders() });
      return (data.settings || []) as BehaviorSetting[];
    },
  });

  const settings = useMemo(() => listQuery.data || [], [listQuery.data]);
  const categories = useMemo(() => {
    const c = new Set(settings.map((s) => s.category || "misc"));
    return Array.from(c.values());
  }, [settings]);

  useEffect(() => {
    if (!categories.length) return;
    if (!categories.includes(selectedCategory)) {
      setSelectedCategory(categories[0]);
    }
  }, [categories, selectedCategory]);

  const currentCategoryItems = useMemo(
    () => settings.filter((s) => (s.category || "misc") === selectedCategory),
    [settings, selectedCategory],
  );

  useEffect(() => {
    if (!currentCategoryItems.length) return;
    if (!currentCategoryItems.some((s) => s.setting_key === selectedKey)) {
      setSelectedKey(currentCategoryItems[0].setting_key);
    }
  }, [currentCategoryItems, selectedKey]);

  const current = currentCategoryItems.find((s) => s.setting_key === selectedKey) || null;

  useEffect(() => {
    if (!current) return;
    setDraft(
      current.type === "text"
        ? String(current.value ?? "")
        : JSON.stringify(current.value, null, 2),
    );
  }, [current]);

  const save = useMutation({
    mutationFn: async () => {
      if (!current) return;
      let value: unknown = draft;
      if (current.type !== "text") {
        value = JSON.parse(draft);
      }
      await requestJson(`/admin/behavior-settings/${encodeURIComponent(current.setting_key)}`, {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify({ value }),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["behavior-settings"] });
    },
  });

  const reset = useMutation({
    mutationFn: async () => {
      if (!current) return;
      await requestJson(`/admin/behavior-settings/${encodeURIComponent(current.setting_key)}/reset`, {
        method: "POST",
        headers: agentHeaders(),
      });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["behavior-settings"] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Comportements moteur</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">
          Registre central des comportements non métiers : délais, filets, formats de réponse et contraintes
          d&apos;orchestration. Chaque clé a une description ci-dessous : lis-la avant de modifier une valeur.
          Les changements sont persistés en base et pris en compte au prochain tour d&apos;orchestration.
        </p>
      </div>

      <div className="mobile-tab-bar lg:hidden">
        <button
          type="button"
          onClick={() => setMobilePane("browse")}
          className={`mobile-tab ${mobilePane === "browse" ? "mobile-tab-active" : "mobile-tab-inactive"}`}
        >
          Catégories & clés
        </button>
        <button
          type="button"
          onClick={() => current && setMobilePane("edit")}
          disabled={!current}
          className={`mobile-tab ${mobilePane === "edit" ? "mobile-tab-active" : "mobile-tab-inactive"} disabled:opacity-40`}
        >
          Édition
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,220px)_minmax(0,280px)_1fr]">
        <div
          className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${
            mobilePane === "browse" ? "block" : "hidden lg:block"
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Catégories</p>
          <div className="space-y-1">
            {categories.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`min-h-[44px] w-full rounded-lg px-3 py-2.5 text-left text-sm font-medium ${
                  selectedCategory === cat ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {CATEGORY_LABELS[cat] || cat}
              </button>
            ))}
          </div>
        </div>

        <div
          className={`rounded-2xl border border-slate-200 bg-white p-3 shadow-sm ${
            mobilePane === "browse" ? "block" : "hidden lg:block"
          }`}
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Clés</p>
          <div className="space-y-1">
            {currentCategoryItems.map((item) => (
              <button
                key={item.setting_key}
                type="button"
                onClick={() => {
                  setSelectedKey(item.setting_key);
                  if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
                    setMobilePane("edit");
                  }
                }}
                className={`min-h-[44px] w-full rounded-lg px-3 py-2.5 text-left ${
                  selectedKey === item.setting_key ? "bg-violet-50 text-violet-900" : "hover:bg-slate-50"
                }`}
              >
                <div className="text-xs font-semibold">{item.label}</div>
                {item.description ? (
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500">{item.description}</div>
                ) : null}
                <div className="mt-0.5 font-mono text-[11px] text-slate-400">{item.setting_key}</div>
              </button>
            ))}
          </div>
        </div>

        <div
          className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${
            mobilePane === "edit" ? "block" : "hidden lg:block"
          }`}
        >
          {!current ? (
            <p className="text-sm text-slate-500">Aucun réglage à afficher.</p>
          ) : (
            <>
              <div className="mb-3">
                <p className="text-sm font-semibold text-slate-900">{current.label}</p>
                <p className="font-mono text-xs text-slate-500">{current.setting_key}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Type: <span className="font-mono">{current.type}</span>
                  {current.updated_at ? (
                    <span>
                      {" "}
                      · Dernière mise à jour <span className="font-mono">{String(current.updated_at)}</span>
                    </span>
                  ) : null}
                </p>
                {current.description ? (
                  <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                    {current.description}
                  </div>
                ) : null}
              </div>

              {current.type === "text" ? (
                <textarea
                  rows={18}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-900"
                />
              ) : (
                <textarea
                  rows={18}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  spellCheck={false}
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-[12px] leading-relaxed text-slate-900"
                />
              )}

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate()}
                  className="min-h-[44px] rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                >
                  {save.isPending ? "Sauvegarde..." : "Sauvegarder"}
                </button>
                <button
                  type="button"
                  disabled={reset.isPending}
                  onClick={() => reset.mutate()}
                  className="min-h-[44px] rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
                >
                  {reset.isPending ? "Reset..." : "Réinitialiser"}
                </button>
              </div>

              {save.isError ? (
                <p className="mt-2 text-sm text-red-700">
                  {save.error instanceof Error ? save.error.message : String(save.error)}
                </p>
              ) : null}
              {reset.isError ? (
                <p className="mt-2 text-sm text-red-700">
                  {reset.error instanceof Error ? reset.error.message : String(reset.error)}
                </p>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

