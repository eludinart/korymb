"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import HealthDot from "../../../components/HealthDot";
import { ConnectorRepairPanel, ConnectorStatusBadge } from "../../../components/ConnectorStatusBlock";
import { PageHeader, SectionCard } from "../../../components/ui/PageChrome";
import { agentHeaders, requestJson } from "../../../lib/api";
import type { HealthTone } from "../../../lib/healthTone";
import {
  integrationGroupStatusLabel,
  integrationGroupTone,
  resolveIntegrationCardId,
} from "../../../lib/integrationGroupTone";
import {
  DIRECTORY_TILES,
  connectorMeta,
  familyMeta,
  fieldFamily,
  resolveDirectoryTile,
  splitTileFields,
  tileHaystack,
  tileStatusLabel,
  tileTone,
} from "../../../lib/integrationConnectors";
import type { IntegrationRow } from "../../../lib/integrationHealth";
import { connectorHealthForTile } from "../../../lib/integrationRepairGuide";

type IntegrationField = {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
  hint?: string;
  setup_url?: string;
  setup_label?: string;
  advanced?: boolean;
};

type IntegrationGroup = {
  id: string;
  label: string;
  description?: string;
  priority?: boolean;
  section?: string;
  oauth?: string;
  oauth_ready?: boolean;
  setup_url?: string;
  setup_label?: string;
  setup_how?: string;
  fields: IntegrationField[];
};

/** Carte affichée (peut fusionner plusieurs groupes catalogue). */
type DisplayCard = IntegrationGroup & {
  sourceIds: string[];
};

type IntegrationSettingsResponse = {
  catalog: IntegrationGroup[];
  values: Record<string, unknown>;
};

const SECTION_ORDER = ["essentials", "creative", "business", "advanced"] as const;

/** Aligné sur backend/integration_catalog.py — repli si l’API n’envoie pas encore `section`. */
const SECTION_FALLBACK: Record<string, (typeof SECTION_ORDER)[number]> = {
  google_oauth: "essentials",
  google_drive: "essentials",
  google_workspace: "essentials",
  wordpress: "essentials",
  meta_social: "essentials",
  linkedin_publish: "essentials",
  email: "essentials",
  media_ai: "creative",
  tts: "creative",
  video_gen: "creative",
  newsletter: "business",
  tiime: "business",
  messaging: "business",
  youtube: "business",
  visual_social: "business",
  google_analytics: "advanced",
  web_search: "advanced",
  whatsapp: "advanced",
  crm: "advanced",
  payments: "advanced",
  fleur_db: "advanced",
};

const GOOGLE_SOURCE_IDS = ["google_oauth", "google_drive", "google_workspace"] as const;
const CREATIVE_SOURCE_IDS = ["media_ai", "tts", "video_gen"] as const;

/** Repli si l’API n’envoie pas encore `advanced` sur les champs. */
const ADVANCED_FIELD_FALLBACK = new Set([
  "GOOGLE_API_ACCESS_TOKEN",
  "GOOGLE_OAUTH_REFRESH_TOKEN",
  "GOOGLE_OAUTH_TOKEN_ENDPOINT",
  "GOOGLE_DRIVE_ACCESS_TOKEN",
  "GOOGLE_GMAIL_ACCESS_TOKEN",
  "GOOGLE_CALENDAR_ACCESS_TOKEN",
  "GOOGLE_SHEETS_ACCESS_TOKEN",
  "GOOGLE_SHEETS_DEFAULT_ID",
  "GOOGLE_ANALYTICS_ACCESS_TOKEN",
  "META_PAGE_ACCESS_TOKEN",
  "META_WEBHOOK_VERIFY_TOKEN",
  "BREVO_DEFAULT_LIST_ID",
  "IMAGE_ENGINE_CHAIN",
  "IMAGE_FREE_ENGINE",
  "IMAGE_FREE_BASE_URL",
  "POLLINATIONS_API_KEY",
  "POLLINATIONS_IMAGE_MODEL",
  "HUGGINGFACE_API_TOKEN",
  "IMAGE_HF_MODEL",
  "IMAGE_GEN_MODEL",
  "IMAGE_GEN_BASE_URL",
  "ANTHROPIC_API_KEY",
  "DEEPL_API_KEY",
  "TTS_ENGINE_CHAIN",
  "TTS_FREE_ENGINE",
  "TTS_EDGE_VOICE",
  "TTS_FREE_BASE_URL",
  "TTS_PROVIDER",
  "TTS_API_KEY",
  "TTS_BASE_URL",
  "TTS_MODEL",
  "TTS_VOICE",
  "TTS_OUTPUT_DIR",
  "ELEVENLABS_MODEL",
  "OPENAI_API_KEY",
  "VIDEO_ENGINE_CHAIN",
  "VIDEO_HF_MODEL",
  "VIDEO_GEN_PROVIDER",
  "VIDEO_GEN_MODEL",
  "VIDEO_GEN_API_KEY",
  "RUNWAY_API_KEY",
  "CANVA_DEFAULT_TEMPLATE_ID",
  "PINTEREST_BOARD_ID",
  "DISCORD_BOT_TOKEN",
  "DISCORD_CHANNEL_ID",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "KORYMB_PUBLIC_URL",
  "KORYMB_WEBHOOK_URL",
  "NOTIFICATION_WEBHOOK_URL",
  "LINKEDIN_AUTHOR_URN",
  "PAYPAL_API_BASE",
]);

function isAdvancedField(field: IntegrationField): boolean {
  if (typeof field.advanced === "boolean") return field.advanced;
  return ADVANCED_FIELD_FALLBACK.has(field.key);
}

function cardSection(group: IntegrationGroup): (typeof SECTION_ORDER)[number] {
  const raw = (group.section || SECTION_FALLBACK[group.id] || "advanced") as string;
  return (SECTION_ORDER.includes(raw as (typeof SECTION_ORDER)[number])
    ? raw
    : "advanced") as (typeof SECTION_ORDER)[number];
}

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

function oauthCallbackPath(): string {
  return "/administration/integrations/oauth/callback";
}

function oauthCallbackUri(origin?: string): string {
  if (typeof window === "undefined" && !origin) return "";
  const base = (origin || window.location.origin).replace(/\/+$/, "");
  return `${base}${oauthCallbackPath()}`;
}

function oauthCallbackAliases(): string[] {
  if (typeof window === "undefined") return [];
  const primary = oauthCallbackUri();
  const { protocol, hostname, port } = window.location;
  const hostPort = port ? `:${port}` : "";
  const altHost = hostname === "localhost" ? "127.0.0.1" : hostname === "127.0.0.1" ? "localhost" : "";
  if (!altHost) return [primary];
  return [primary, `${protocol}//${altHost}${hostPort}${oauthCallbackPath()}`];
}

function wordpressSetupUrl(base: string): string {
  const raw = base.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) return "";
  return `${raw}/wp-admin/authorize-application.php?app_name=Korymb`;
}

function SetupLink({ href, label }: { href?: string; label?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-xs font-semibold text-violet-700 underline decoration-violet-300 underline-offset-2 hover:text-violet-900"
    >
      {label || "Créer la clé chez le fournisseur"}
    </a>
  );
}

function buildDisplayCards(catalog: IntegrationGroup[]): DisplayCard[] {
  const byId = new Map(catalog.map((g) => [g.id, g]));
  const used = new Set<string>();
  const cards: DisplayCard[] = [];

  const oauth = byId.get("google_oauth");
  if (oauth) {
    const parts = GOOGLE_SOURCE_IDS.map((id) => byId.get(id)).filter(Boolean) as IntegrationGroup[];
    for (const p of parts) used.add(p.id);
    cards.push({
      id: "google",
      label: "Google Workspace",
      description: "Gmail, Drive, Calendar, Sheets — un compte, un clic",
      section: "essentials",
      priority: true,
      oauth: oauth.oauth,
      oauth_ready: oauth.oauth_ready,
      setup_url: oauth.setup_url,
      setup_label: oauth.setup_label,
      setup_how: oauth.setup_how,
      fields: parts.flatMap((p) => p.fields),
      sourceIds: parts.map((p) => p.id),
    });
  }

  const media = byId.get("media_ai");
  if (media) {
    const parts = CREATIVE_SOURCE_IDS.map((id) => byId.get(id)).filter(Boolean) as IntegrationGroup[];
    for (const p of parts) used.add(p.id);
    cards.push({
      id: "creative_media",
      label: "Médias créatifs",
      description: "Images, voix et vidéo — gratuit d’abord, clés pour la qualité publication",
      section: "creative",
      priority: true,
      setup_url: media.setup_url,
      setup_label: media.setup_label,
      setup_how:
        "Le Studio choisit Économique ou Qualité. Sans clé : images et voix gratuites. Une clé OpenRouter / ElevenLabs / Replicate débloque la qualité.",
      fields: parts.flatMap((p) => p.fields),
      sourceIds: parts.map((p) => p.id),
    });
  }

  for (const g of catalog) {
    if (used.has(g.id)) continue;
    cards.push({ ...g, section: cardSection(g), sourceIds: [g.id] });
  }

  const sectionRank = (s: string | undefined) => {
    const i = SECTION_ORDER.indexOf((s || "advanced") as (typeof SECTION_ORDER)[number]);
    return i < 0 ? 99 : i;
  };
  cards.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || a.label.localeCompare(b.label, "fr"));
  return cards;
}

function FieldGrid({
  fields,
  requestedField,
  values,
  fieldValue,
  setField,
  clearSecret,
  savePending,
}: {
  fields: IntegrationField[];
  requestedField: string;
  values: Record<string, unknown>;
  fieldValue: (key: string, secret: boolean) => string;
  setField: (key: string, val: string) => void;
  clearSecret: (key: string) => void;
  savePending: boolean;
}) {
  const buckets: { family: string; fields: IntegrationField[] }[] = [];
  const byFam = new Map<string, IntegrationField[]>();
  for (const field of fields) {
    const fam = fieldFamily(field.key);
    if (!byFam.has(fam)) byFam.set(fam, []);
    byFam.get(fam)!.push(field);
  }
  const namedFamilies = [...byFam.keys()].filter(Boolean);
  const grouped = namedFamilies.length > 1;
  if (grouped) {
    for (const [family, list] of byFam) buckets.push({ family, fields: list });
  } else {
    buckets.push({ family: "", fields });
  }

  return (
    <div className="space-y-4">
      {buckets.map((bucket) => {
        const fam = bucket.family ? familyMeta(bucket.family) : null;
        const highlighted = Boolean(bucket.family && bucket.fields.some((f) => f.key === requestedField));
        return (
          <section
            key={bucket.family || "fields"}
            id={bucket.family ? `integration-family-${bucket.family}` : undefined}
            className={
              grouped
                ? `rounded-2xl border-2 bg-white p-4 shadow-sm ${
                    highlighted ? "border-violet-500 ring-2 ring-violet-200" : "border-slate-200"
                  }`
                : ""
            }
          >
            {fam ? (
              <header className="mb-4 border-b border-slate-100 pb-3">
                <p className="text-sm font-bold text-slate-900">{fam.title}</p>
                {fam.what ? <p className="mt-0.5 text-xs text-slate-500">{fam.what}</p> : null}
              </header>
            ) : null}
            <div className="grid gap-4 sm:grid-cols-2">
              {bucket.fields.map((field) => {
                const secret = field.secret !== false;
                const setFlag = values[`${field.key}_set`] === true;
                const source = String(values[`${field.key}_source`] ?? "");
                return (
                  <label
                    key={field.key}
                    id={`integration-field-${field.key}`}
                    className={`block scroll-mt-28 space-y-1.5 rounded-xl p-1 ${
                      requestedField === field.key ? "-m-1 bg-violet-50 ring-2 ring-violet-300" : ""
                    }`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-slate-700">{field.label}</span>
                      <HealthDot tone={sourceTone(source)} label={sourceLabel(source)} />
                      {setFlag && secret ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800">
                          clé définie
                        </span>
                      ) : null}
                      <SetupLink href={field.setup_url} label={field.setup_label} />
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
                    {field.hint ? <p className="text-[11px] text-slate-500">{field.hint}</p> : null}
                    {secret && setFlag ? (
                      <button
                        type="button"
                        className="text-[11px] font-medium text-red-700 hover:underline"
                        onClick={() => clearSecret(field.key)}
                        disabled={savePending}
                      >
                        Effacer la clé enregistrée
                      </button>
                    ) : null}
                  </label>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function IntegrationsSettingsPage() {
  return (
    <Suspense fallback={<div className="space-y-6 p-6 text-sm text-slate-500">Chargement des intégrations…</div>}>
      <IntegrationsSettingsContent />
    </Suspense>
  );
}

function IntegrationsSettingsContent() {
  const qc = useQueryClient();
  const searchParams = useSearchParams();
  const requestedGroupRaw = (searchParams.get("group") || "").trim();
  const requestedCardId = requestedGroupRaw ? resolveIntegrationCardId(requestedGroupRaw) : "";
  const requestedField = (searchParams.get("field") || "").trim();
  const requestedTile = (searchParams.get("tile") || "").trim();
  const requestedTechnique = searchParams.get("technique") === "1";
  const oauthOk = searchParams.get("oauth") === "ok";
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [oauthBusy, setOauthBusy] = useState("");
  const [oauthError, setOauthError] = useState("");
  const [oauthRedirectUris, setOauthRedirectUris] = useState<string[]>([]);
  const [openGroup, setOpenGroup] = useState<string>(requestedCardId);
  const [showTechnique, setShowTechnique] = useState(requestedTechnique);
  const [openAdvancedFields, setOpenAdvancedFields] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [focusTileId, setFocusTileId] = useState(requestedTile);
  const [focusField, setFocusField] = useState(requestedField);
  const appliedTarget = useRef("");

  useEffect(() => {
    setOauthRedirectUris(oauthCallbackAliases());
  }, []);

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
  const displayCards = useMemo(() => buildDisplayCards(catalog), [catalog]);
  const values = query.data?.values ?? {};

  const directoryTiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const base = DIRECTORY_TILES.filter((t) => showTechnique || !t.technique);
    if (!q) return base;
    return DIRECTORY_TILES.filter((t) => (showTechnique || !t.technique) && tileHaystack(t).includes(q));
  }, [showTechnique, searchQuery]);

  const openCard = displayCards.find((c) => c.id === openGroup) ?? null;
  const activeField = requestedField || focusField;

  useEffect(() => {
    if (!displayCards.length) return;
    const fromQuery = requestedTile ? DIRECTORY_TILES.find((t) => t.id === requestedTile) : undefined;
    const tile = fromQuery || (requestedCardId ? resolveDirectoryTile(requestedCardId, requestedField) : undefined);
    const cardId = tile?.cardId || requestedCardId;
    if (!cardId) return;
    const card = displayCards.find((g) => g.id === cardId);
    if (!card) return;
    if ((card.section || "advanced") === "advanced" || tile?.technique || requestedTechnique) {
      setShowTechnique(true);
    }
    if (tile) setFocusTileId(tile.id);
    if (
      requestedField &&
      card.fields.some((f) => f.key === requestedField && isAdvancedField(f)) &&
      !(tile?.simpleKeys || []).includes(requestedField)
    ) {
      setOpenAdvancedFields((prev) => ({ ...prev, [tile?.id || cardId]: true }));
    }
    const key = `${cardId}:${requestedField}:${requestedTile}`;
    if (appliedTarget.current !== key) {
      appliedTarget.current = key;
      setOpenGroup(cardId);
    }
  }, [displayCards, requestedCardId, requestedField, requestedTile, requestedTechnique]);

  useEffect(() => {
    if (!openGroup) return;
    const targetId = requestedField ? `integration-field-${requestedField}` : `integration-${openGroup}`;
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [requestedCardId, requestedField, requestedTile, openGroup, showTechnique, directoryTiles.length]);

  useEffect(() => {
    if (!searchQuery.trim() || directoryTiles.length !== 1) return;
    const tile = directoryTiles[0];
    setOpenGroup(tile.cardId);
    setFocusTileId(tile.id);
    if (tile.field) setFocusField(tile.field);
  }, [searchQuery, directoryTiles]);

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

  function fieldValue(key: string, secret: boolean): string {
    if (key in drafts) return drafts[key];
    if (secret) return "";
    return String(values[key] ?? "");
  }

  function setField(key: string, val: string) {
    setDrafts((d) => ({ ...d, [key]: val }));
  }

  function saveCard(card: DisplayCard) {
    const fields: Record<string, string> = {};
    for (const f of card.fields) {
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

  async function connectOAuth(provider: string) {
    setOauthError("");
    setOauthBusy(provider);
    try {
      const { data } = await requestJson("/admin/integrations/oauth/start", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify({ provider, redirect_uri: oauthCallbackUri() }),
      });
      const url = String((data as { authorize_url?: string }).authorize_url || "");
      if (!url) throw new Error("URL de connexion manquante.");
      window.location.href = url;
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "Connexion impossible.");
      setOauthBusy("");
    }
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
  const tiimeWebhookSet =
    values.TIIME_MAKE_WEBHOOK_URL_set === true || Boolean(String(values.TIIME_MAKE_WEBHOOK_URL || "").trim());

  function jumpToCard(cardId: string, opts?: { field?: string; family?: string; tileId?: string }) {
    const card = displayCards.find((c) => c.id === cardId);
    if (card && (card.section || "advanced") === "advanced") setShowTechnique(true);
    setSearchQuery("");
    setOpenGroup(cardId);
    setFocusTileId(opts?.tileId || "");
    setFocusField(opts?.field || "");
    window.setTimeout(() => {
      const id = opts?.field
        ? `integration-field-${opts.field}`
        : opts?.family
          ? `integration-family-${opts.family}`
          : `integration-${cardId}`;
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        accent="violet"
        badge="Administration"
        title="Intégrations"
        description="Annuaire des comptes à brancher. Cliquez un nom ci-dessous : Google, LinkedIn, Instagram, WordPress…"
      />

      {oauthOk ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          Compte connecté — le jeton a été enregistré. Vous pouvez fermer les fenêtres du fournisseur.
        </div>
      ) : null}

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
          <p className="font-bold">Google à réparer</p>
          <p className="mt-1 text-amber-900">
            Gmail / Calendar en échec
            {driveHealth?.probe_detail ? ` (${driveHealth.probe_detail})` : ""}.
            Rouvrez Google Workspace et recliquez sur Connecter Google. Les livrables restent dans Korymb sans Drive.
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

      <SectionCard title="Annuaire des connecteurs">
        {query.isLoading ? <p className="text-sm text-slate-500">Chargement…</p> : null}
        {query.isError ? (
          <p className="text-sm text-red-700">Impossible de charger la configuration intégrations.</p>
        ) : null}
        <label className="block text-xs font-semibold text-slate-700" htmlFor="integration-search">
          Rechercher un nom
        </label>
        <input
          id="integration-search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="LinkedIn, Kling, Gmail, WordPress…"
          className="mt-1 w-full max-w-lg rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
        />
        <p className="mt-3 text-xs text-slate-500">
          Cliquez un connecteur : uniquement les champs pour le brancher. Le reste est en Options avancées.
        </p>
        {query.isSuccess ? (
          <>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {directoryTiles.map((tile) => {
                const parent = displayCards.find((c) => c.id === tile.cardId);
                const parentTone = parent
                  ? integrationGroupTone(parent, values, health.data?.integrations)
                  : ("neutral" as const);
                const parentLabel = parent
                  ? integrationGroupStatusLabel(parent, values, health.data?.integrations)
                  : "À brancher";
                const ownLabel = tile.id === "google" ? "" : tileStatusLabel(tile, values);
                const fallbackTone =
                  tile.id === "google" && parent
                    ? parentTone
                    : ownLabel
                      ? tileTone(tile, values)
                      : parentTone;
                const fallbackLabel =
                  tile.id === "google" && parent ? parentLabel : ownLabel || parentLabel;
                const healthView = connectorHealthForTile(
                  tile.id,
                  health.data?.integrations as Record<string, IntegrationRow> | undefined,
                  { tone: fallbackTone, label: fallbackLabel },
                );
                const tone = healthView.tone;
                const statusLabel = healthView.label;
                const active = focusTileId === tile.id || (!focusTileId && openGroup === tile.cardId && !tile.family);
                return (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() =>
                      jumpToCard(tile.cardId, { field: tile.field, family: tile.family, tileId: tile.id })
                    }
                    className={`flex min-h-[7.5rem] items-start gap-3 rounded-2xl border-2 px-4 py-3.5 text-left shadow-sm transition ${
                      active
                        ? "border-violet-500 bg-violet-50 ring-2 ring-violet-200"
                        : "border-slate-200 bg-white hover:border-violet-300 hover:shadow-md"
                    }`}
                  >
                    <HealthDot tone={tone} label={`${tile.title} — ${statusLabel}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">{tile.title}</span>
                        <ConnectorStatusBadge tone={tone} label={statusLabel} />
                      </span>
                      <span className="mt-1 block text-[11px] leading-snug text-slate-500">{tile.what}</span>
                      {healthView.guide ? (
                        <span className="mt-1.5 block text-[11px] leading-snug text-amber-900">
                          {healthView.guide.reason}
                        </span>
                      ) : null}
                      {tile.tags.length ? (
                        <span className="mt-2 flex flex-wrap gap-1">
                          {tile.tags.map((tag) => (
                            <span
                              key={tag}
                              className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600"
                            >
                              {tag}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Pastille alignée sur Santé système : vert = opérationnel, orange = clé manquante / non vérifié, rouge = à
              réparer. Images, voix et recherche web marchent déjà sans clé.
            </p>
          </>
        ) : null}
        <label className="mt-3 flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={showTechnique}
            onChange={(e) => setShowTechnique(e.target.checked)}
          />
          Afficher la section technique (Analytics, CRM, paiements…)
        </label>
      </SectionCard>

      {searchQuery.trim() && directoryTiles.length === 0 ? (
        <p className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Aucun connecteur pour « {searchQuery.trim()} ». Essayez LinkedIn, Google, Kling, Instagram…
        </p>
      ) : null}

      {openCard ? (
        (() => {
          const group = openCard;
          const tone = integrationGroupTone(group, values, health.data?.integrations);
          const statusLabel = integrationGroupStatusLabel(group, values, health.data?.integrations);
          const meta = connectorMeta(group.id, group.label, group.description);
          const focusTile =
            DIRECTORY_TILES.find((t) => t.id === focusTileId) ||
            resolveDirectoryTile(group.id, activeField);
          const headerTitle = focusTile?.title || meta.title;
          const headerWhat = focusTile?.what || meta.what || group.description;
          const { simple: simpleFields, advanced: advancedFields } = splitTileFields(focusTile, group.fields);
          const tileOwnLabel = focusTile && focusTile.id !== "google" ? tileStatusLabel(focusTile, values) : "";
          const fallbackTone = focusTile
            ? focusTile.id === "google"
              ? tone
              : tileOwnLabel
                ? tileTone(focusTile, values)
                : tone
            : tone;
          const fallbackStatus =
            focusTile?.id === "google"
              ? statusLabel
              : focusTile
                ? tileOwnLabel || statusLabel
                : statusLabel;
          const healthView = connectorHealthForTile(
            focusTile?.id || group.id,
            health.data?.integrations as Record<string, IntegrationRow> | undefined,
            { tone: fallbackTone, label: fallbackStatus },
          );
          const tileToneValue = healthView.tone;
          const tileStatus = healthView.label;
          const howto = focusTile?.howto || (!focusTile?.family ? group.setup_how : "");
          const setupUrl = focusTile?.setupUrl || group.setup_url;
          const setupLabel = focusTile?.setupLabel || group.setup_label;
          const showOauth =
            Boolean(group.oauth) &&
            (!focusTile || focusTile.id === "google" || focusTile.id === "linkedin");
          const advKey = focusTile?.id || group.id;
          const advOpen = Boolean(openAdvancedFields[advKey]);
          const highlight =
            requestedCardId === group.id ||
            (requestedGroupRaw && group.sourceIds.includes(requestedGroupRaw));
          return (
            <div
              id={`integration-${group.id}`}
              className={`scroll-mt-28 rounded-2xl border bg-white shadow-sm ${
                highlight ? "border-violet-400 ring-2 ring-violet-200" : "border-violet-200"
              }`}
            >
              <div className="flex items-start gap-3 px-4 py-3">
                <HealthDot tone={tileToneValue} label={`${headerTitle} — ${tileStatus}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-violet-700">Branchement</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-2">
                    <p className="text-base font-semibold text-slate-900">{headerTitle}</p>
                    <ConnectorStatusBadge tone={tileToneValue} label={tileStatus} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{headerWhat}</p>
                  {(focusTile?.tags || meta.tags).length ? (
                    <p className="mt-1.5 flex flex-wrap gap-1">
                      {(focusTile?.tags || meta.tags).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                        >
                          {tag}
                        </span>
                      ))}
                    </p>
                  ) : null}
                  {healthView.guide ? <ConnectorRepairPanel guide={healthView.guide} /> : null}
                </div>
                <button
                  type="button"
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800"
                  onClick={() => {
                    setOpenGroup("");
                    setFocusTileId("");
                    setFocusField("");
                  }}
                >
                  Fermer
                </button>
              </div>
              <div className="border-t border-slate-100 bg-slate-50 px-4 py-5">
                {howto || setupUrl || showOauth ? (
                  <div className="mb-4 rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-3 text-sm text-violet-950">
                    {howto ? <p>{howto}</p> : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <SetupLink href={setupUrl} label={setupLabel} />
                      {group.id === "wordpress" || group.sourceIds.includes("wordpress") ? (
                        <SetupLink
                          href={wordpressSetupUrl(String(drafts.WP_BASE_URL || values.WP_BASE_URL || ""))}
                          label="Créer un mot de passe d’application sur le site"
                        />
                      ) : null}
                      {showOauth ? (
                        <>
                          <button
                            type="button"
                            className="rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                            disabled={Boolean(oauthBusy) || !group.oauth_ready}
                            onClick={() => void connectOAuth(group.oauth || "")}
                          >
                            {oauthBusy === group.oauth
                              ? "Redirection…"
                              : group.oauth === "google"
                                ? "Connecter Google"
                                : "Connecter LinkedIn"}
                          </button>
                          <button
                            type="button"
                            className="text-xs font-semibold text-violet-800 underline"
                            onClick={() => {
                              const uri = oauthCallbackUri();
                              void navigator.clipboard.writeText(uri);
                              setMsg({ ok: true, text: `URI à coller chez le fournisseur : ${uri}` });
                            }}
                          >
                            Copier l’URI de redirection
                          </button>
                        </>
                      ) : null}
                    </div>
                    {showOauth ? (
                      <div className="mt-3 space-y-1.5">
                        <p className="text-xs font-semibold text-violet-900">
                          URI à coller dans l’app (Auth → Authorized redirect URLs)
                        </p>
                        {oauthRedirectUris.map((uri, idx) => (
                          <code
                            key={uri}
                            className="block break-all rounded-lg bg-white px-2 py-1.5 text-[11px] text-violet-950 ring-1 ring-violet-200"
                          >
                            {uri}
                            {idx === 1 ? " — à enregistrer aussi si vous ouvrez Korymb via cette adresse" : ""}
                          </code>
                        ))}
                        {group.oauth === "linkedin" ? (
                          <p className="text-xs text-violet-800">
                            LinkedIn compare l’URI au caractère près. Si la page LinkedIn dit que
                            l’URI ne correspond pas, ajoutez exactement la première ligne dans l’onglet
                            Auth, enregistrez, puis reconnectez.
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {showOauth && !group.oauth_ready ? (
                      <p className="mt-2 text-xs text-violet-800">
                        Collez Client ID et Client Secret ci-dessous, enregistrez, puis connectez.
                      </p>
                    ) : null}
                    {showOauth && oauthError ? <p className="mt-2 text-xs text-red-700">{oauthError}</p> : null}
                  </div>
                ) : null}

                <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm">
                <FieldGrid
                  fields={simpleFields}
                  requestedField={activeField}
                  values={values}
                  fieldValue={fieldValue}
                  setField={setField}
                  clearSecret={clearSecret}
                  savePending={save.isPending}
                />
                </div>

                {advancedFields.length ? (
                  <details
                    className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2"
                    open={advOpen}
                    onToggle={(e) => {
                      const open = (e.target as HTMLDetailsElement).open;
                      setOpenAdvancedFields((prev) => ({ ...prev, [advKey]: open }));
                    }}
                  >
                    <summary className="cursor-pointer select-none text-xs font-semibold text-slate-700">
                      Options avancées ({advancedFields.length})
                    </summary>
                    <div className="mt-3 pb-1">
                      <FieldGrid
                        fields={advancedFields}
                        requestedField={activeField}
                        values={values}
                        fieldValue={fieldValue}
                        setField={setField}
                        clearSecret={clearSecret}
                        savePending={save.isPending}
                      />
                    </div>
                  </details>
                ) : null}

                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    disabled={save.isPending}
                    onClick={() => saveCard(group)}
                    className="rounded-lg bg-violet-700 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-50"
                  >
                    {save.isPending ? "Enregistrement…" : `Enregistrer — ${headerTitle}`}
                  </button>
                </div>
              </div>
            </div>
          );
        })()
      ) : query.isSuccess ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
          Cliquez un connecteur dans l’annuaire pour coller la clé ou connecter le compte.
        </p>
      ) : null}
    </div>
  );
}
