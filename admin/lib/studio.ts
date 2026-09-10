import { agentHeaders, requestJson } from "./api";

export type StudioFormat = {
  id: string;
  label: string;
  group: string;
  icon: string;
  description: string;
  resource_type: string;
  channels: string[];
  tools: string[];
  duration_hint: string;
  brief: string;
  missing_connections: string[];
  ready: boolean;
};

export type StudioTone = { id: string; label: string; hint: string };
export type StudioAudience = { id: string; label: string };
export type StudioDestination = { id: string; label: string; hint: string };
export type StudioVisibility = { id: string; label: string };

export type StudioConnection = {
  id: string;
  label: string;
  role: string;
  configured: boolean;
  required_for: string[];
  setup?: string;
  docs?: string;
  note?: string;
};

export type StudioBrand = {
  name: string;
  tagline: string;
  has_logo: boolean;
  has_global_memory: boolean;
  has_community_memory: boolean;
  accent: string;
};

export type StudioCatalog = {
  formats: StudioFormat[];
  tones: StudioTone[];
  audiences: StudioAudience[];
  destinations: StudioDestination[];
  visibilities: StudioVisibility[];
  connections: StudioConnection[];
  brand: StudioBrand;
  ethics: string[];
  media?: {
    mode: string;
    modes: { id: string; label: string; hint: string }[];
    engines?: Record<string, { id: string; ready: boolean; free?: boolean }[]>;
    ready?: Record<string, boolean>;
  };
};

export type StudioPiece = {
  format_id: string;
  label: string;
  in_app: boolean;
  channel: string;
  channel_label: string;
  resource_type: string;
  file_id: string;
  title: string;
  body_preview: string;
  connector_ready: boolean;
  connector_setup: string;
  pending_ticket_id: string;
  can_publish_in_app: boolean;
  can_publish_channel: boolean;
  youtube_upload?: boolean;
  queue_state?: "pending" | "published" | "dismissed";
};

export type StudioRun = {
  job_id: string;
  status: string;
  agent: string;
  formats: string[];
  created_at?: string;
  mission_preview?: string;
  result_preview?: string;
  pieces?: StudioPiece[];
  can_dismiss?: boolean;
};

export type StudioGeneratePayload = {
  prompt: string;
  formats: string[];
  tone: string;
  audience: string;
  cta: string;
  destination: string;
  visibility: string;
  extra: string;
  project_id?: string;
  require_user_validation: boolean;
  media_engine_mode?: string;
};

export const studioApi = {
  catalog: async () =>
    (await requestJson("/studio/catalog", { headers: agentHeaders() })).data as StudioCatalog,
  runs: async () =>
    ((await requestJson("/studio/runs", { headers: agentHeaders() })).data.runs || []) as StudioRun[],
  generate: async (body: StudioGeneratePayload) =>
    (
      await requestJson("/studio/generate", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      })
    ).data as {
      status: string;
      job_id: string;
      agent: string;
      formats: string[];
      destination: string;
      next?: { mission?: string; inbox?: string; hint?: string };
    },
  publish: async (body: {
    title: string;
    resource_type: string;
    visibility: string;
    file_id?: string;
    notes?: string;
    job_id?: string;
    body_markdown?: string;
    project_id?: string;
  }) =>
    (
      await requestJson("/studio/publish", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      })
    ).data as { event?: { id?: string; title?: string }; message?: string },
  release: async (body: {
    job_id: string;
    format_id?: string;
    target?: string;
    visibility?: string;
    title?: string;
  }) =>
    (
      await requestJson("/studio/release", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
        timeoutMs: 60_000,
      })
    ).data as { message?: string; channel?: string; event?: { id?: string } },
  dismiss: async (body: { job_id: string; format_id?: string; confirm: string }) =>
    (
      await requestJson("/studio/dismiss", {
        method: "POST",
        headers: agentHeaders(),
        body: JSON.stringify(body),
      })
    ).data as { ok?: boolean; message?: string; dismissed?: string },
};

export function formatStatus(status?: string): string {
  const s = (status || "").toLowerCase();
  if (s === "running") return "En production";
  if (s === "completed") return "Prêt à publier";
  if (s === "awaiting_validation") return "Plan à valider";
  if (s === "cancelled") return "Annulé";
  if (s === "failed") return "Échec";
  return status || "—";
}

/** Fallback si le catalogue n’a pas encore le deep-link (backend à relancer). */
const CONNECTION_SETUP: Record<string, string> = {
  memory: "/administration/memory",
  image: "/admin/korymb-llm",
  tts: "/administration/integrations?group=tts&field=TTS_ENGINE_CHAIN",
  wordpress: "/administration/integrations?group=wordpress&field=WP_BASE_URL",
  meta: "/administration/integrations?group=meta_social&field=INSTAGRAM_ACCESS_TOKEN",
  linkedin: "/administration/integrations?group=linkedin_publish&field=LINKEDIN_ACCESS_TOKEN",
  pinterest: "/administration/integrations?group=visual_social&field=PINTEREST_ACCESS_TOKEN",
  canva: "/administration/integrations?group=visual_social&field=CANVA_API_KEY",
  video_gen: "/admin/korymb-llm",
  youtube: "/administration/integrations?group=youtube&field=YOUTUBE_API_KEY",
  brevo: "/administration/integrations?group=newsletter&field=BREVO_API_KEY",
  drive: "/administration/integrations?group=google&field=GOOGLE_OAUTH_REFRESH_TOKEN",
};

export function connectionSetupHref(connection: Pick<StudioConnection, "id" | "setup">): string {
  const setup = (connection.setup || "").trim();
  if (setup.includes("group=") || setup.includes("/memory") || setup.includes("/vitrine") || setup.includes("/korymb-llm")) return setup;
  return CONNECTION_SETUP[connection.id] || setup || "/administration/integrations";
}
