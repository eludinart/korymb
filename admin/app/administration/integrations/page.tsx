"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import HealthDot from "../../../components/HealthDot";
import { PageHeader, SectionCard } from "../../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../../lib/api";
import type { HealthTone } from "../../../lib/healthTone";

type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  hint?: string;
};

type IntegrationGroup = {
  id: string;
  label: string;
  description?: string;
  priority?: boolean;
  fields: IntegrationField[];
};

type IntegrationSettingsResponse = {
  catalog: IntegrationGroup[];
  values: Record<string, unknown>;
};

function sourceTone(source: string | undefined): HealthTone {
  if (source === "runtime") return "ok";
  if (source === "env") return "warn";
  return "neutral";
}

function sourceLabel(source: string | undefined): string {
  if (source === "runtime") return "Configuré (application)";
  if (source === "env") return "Depuis .env";
  return "Non configuré";
}

export default function IntegrationsSettingsPage() {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openGroup, setOpenGroup] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  const query = useQuery({
    queryKey: ["integration-settings"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/integration-settings", {
        headers: agentHeaders(),
      });
      return data as IntegrationSettingsResponse;
    },
  });

  const catalog = query.data?.catalog ?? [];
  const visibleCatalog = useMemo(
    () => (showAdvanced ? catalog : catalog.filter((g) => g.priority)),
    [catalog, showAdvanced],
  );
  const values = query.data?.values ?? {};

  useEffect(() => {
    if (visibleCatalog.length && !openGroup) setOpenGroup(visibleCatalog[0]?.id ?? "");
  }, [visibleCatalog, openGroup]);

  const save = useMutation({
    mutationFn: async (payload: { fields: Record<string, string>; clear_fields?: string[] }) => {
      const { data } = await requestJson("/admin/integration-settings", {
        method: "PUT",
        headers: agentHeaders(),
        body: JSON.stringify(payload),
      });
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["integration-settings"], data);
      setDrafts({});
      setMsg({ ok: true, text: "Configuration enregistrée." });
      void qc.invalidateQueries({ queryKey: ["admin-system-health"] });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message || "Erreur de sauvegarde." }),
  });

  const configuredCount = useMemo(() => {
    return catalog.reduce((acc: number, g: IntegrationGroup) => {
      return (
        acc +
        g.fields.filter((f) => values[`${f.key}_set`] === true).length
      );
    }, 0);
  }, [catalog, values]);

  const totalFields = useMemo(
    () => catalog.reduce((acc: number, g: IntegrationGroup) => acc + g.fields.length, 0),
    [catalog],
  );

  function fieldValue(key: string, secret: boolean): string {
    if (key in drafts) return drafts[key];
    if (secret) return "";
    return String(values[key] ?? "");
  }

  function setField(key: string, val: string) {
    setDrafts((d) => ({ ...d, [key]: val }));
  }

  function saveGroup(group: IntegrationGroup) {
    const fields: Record<string, string> = {};
    for (const f of group.fields) {
      if (f.key in drafts) fields[f.key] = drafts[f.key];
    }
    if (!Object.keys(fields).length) {
      setMsg({ ok: false, text: "Aucune modification dans ce module." });
      return;
    }
    setMsg(null);
    save.mutate({ fields });
  }

  function clearSecret(key: string) {
    setMsg(null);
    save.mutate({ fields: {}, clear_fields: [key] });
  }

  const health = useQuery({
    queryKey: ["admin-system-health"],
    queryFn: async () => {
      const { data } = await requestJson("/admin/system-health", { headers: agentHeaders(), retries: 1 });
      return data as {
        integrations?: Record<string, { ok?: boolean; configured?: boolean; probe_detail?: string; folder_id_set?: boolean }>;
      };
    },
    staleTime: 60_000,
  });

  const driveHealth = health.data?.integrations?.google_drive;
  const oauthHealth = health.data?.integrations?.google_oauth;
  const driveBroken = Boolean(
    (driveHealth?.configured && driveHealth?.ok === false) ||
      (oauthHealth?.configured && oauthHealth?.ok === false),
  );
  const tiimeWebhookSet = values.TIIME_MAKE_WEBHOOK_URL_set === true || Boolean(String(values.TIIME_MAKE_WEBHOOK_URL || "").trim());

  return (
    <div className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Administration"
        title="Intégrations & clés API"
        description="Configurez tous les modules depuis l'application. Les valeurs saisies ici priment sur le fichier .env (stockage sécurisé en base)."
      />

      {msg ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            msg.ok ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {msg.text}
        </div>
      ) : null}

      {driveBroken ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-bold">Google Drive / OAuth à réparer</p>
          <p className="mt-1 text-amber-900">
            Export auto des livrables en échec
            {driveHealth?.probe_detail ? ` (${driveHealth.probe_detail})` : ""}.
            Rafraîchissez le refresh token OAuth et renseignez{" "}
            <span className="font-semibold">GOOGLE_DRIVE_FOLDER_ID</span> (module Google OAuth &amp; Drive).
          </p>
        </div>
      ) : null}

      {!tiimeWebhookSet && query.isSuccess ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          <p className="font-bold">Tiime — facturation non automatisée</p>
          <p className="mt-1 text-slate-600">
            Les devis Korymb fonctionnent. Pour pousser une facture automatiquement, configurez{" "}
            <span className="font-semibold">TIIME_MAKE_WEBHOOK_URL</span> (module Tiime) ou ouvrez Tiime manuellement.
          </p>
        </div>
      ) : null}

      <SectionCard title="Vue d'ensemble">
        {query.isLoading ? <p className="text-sm text-slate-500">Chargement…</p> : null}
        {query.isError ? (
          <p className="text-sm text-red-700">Impossible de charger la configuration intégrations.</p>
        ) : null}
        {query.isSuccess ? (
          <p className="text-sm text-slate-700">
            Champs configurés :{" "}
            <span className="font-semibold text-slate-900">
              {configuredCount} / {totalFields}
            </span>
            {" · "}
            <span className="text-slate-500">Les secrets ne sont jamais réaffichés après enregistrement.</span>
          </p>
        ) : null}
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showAdvanced}
            onChange={(e) => setShowAdvanced(e.target.checked)}
          />
          Afficher les intégrations secondaires (WhatsApp, Canva, TTS, CRM externe…)
        </label>
      </SectionCard>

      <div className="space-y-3">
        {visibleCatalog.map((group) => {
          const isOpen = openGroup === group.id;
          const groupConfigured = group.fields.filter((f) => values[`${f.key}_set`] === true).length;
          return (
            <div key={group.id} className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button
                type="button"
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50/80"
                onClick={() => setOpenGroup(isOpen ? "" : group.id)}
              >
                <HealthDot
                  tone={groupConfigured === group.fields.length ? "ok" : groupConfigured > 0 ? "warn" : "neutral"}
                  label={group.label}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{group.label}</p>
                  {group.description ? (
                    <p className="mt-0.5 text-xs text-slate-500">{group.description}</p>
                  ) : null}
                </div>
                <span className="text-xs text-slate-500">
                  {groupConfigured}/{group.fields.length}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-slate-100 px-4 py-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {group.fields.map((field) => {
                      const secret = field.secret !== false;
                      const setFlag = values[`${field.key}_set`] === true;
                      const source = String(values[`${field.key}_source`] ?? "");
                      return (
                        <label key={field.key} className="block space-y-1.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-700">{field.label}</span>
                            <HealthDot tone={sourceTone(source)} label={sourceLabel(source)} />
                            {setFlag && secret ? (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                                clé définie
                              </span>
                            ) : null}
                          </div>
                          <input
                            type={secret ? "password" : "text"}
                            autoComplete="off"
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
                            placeholder={
                              secret
                                ? setFlag
                                  ? "••••••••  (laisser vide pour conserver)"
                                  : field.placeholder || "Coller la clé API"
                                : field.placeholder || ""
                            }
                            value={fieldValue(field.key, secret)}
                            onChange={(e) => setField(field.key, e.target.value)}
                          />
                          <p className="font-mono text-[10px] text-slate-400">{field.key}</p>
                          {secret && setFlag ? (
                            <button
                              type="button"
                              className="text-[11px] font-medium text-red-700 hover:underline"
                              onClick={() => clearSecret(field.key)}
                              disabled={save.isPending}
                            >
                              Effacer la clé enregistrée
                            </button>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                  <div className="mt-4 flex justify-end">
                    <button
                      type="button"
                      disabled={save.isPending}
                      onClick={() => saveGroup(group)}
                      className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                    >
                      {save.isPending ? "Enregistrement…" : `Enregistrer — ${group.label}`}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
