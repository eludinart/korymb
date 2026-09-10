export type StorefrontOffer = {
  title: string;
  summary?: string;
  kind?: string;
};

export type StorefrontEvent = {
  id: string;
  title: string;
  starts_at: string;
  ends_at?: string | null;
  event_type?: string;
  location?: string;
  status?: string;
  modality?: string;
  nature?: string;
  resource_type?: string;
  resource_url?: string;
  has_file?: boolean;
  resource_filename?: string;
  resource_file_mime?: string;
  visibility?: string;
  reserved?: boolean;
  has_cover?: boolean;
  cover_source?: string;
  cover_mime?: string;
};

export type StorefrontPublic = {
  id: string;
  name: string;
  slug: string;
  tagline?: string;
  intro?: string;
  offers?: StorefrontOffer[];
  public_enabled?: boolean;
  location?: string;
  contact_email?: string;
  contact_url?: string;
  accent?: string;
  paper?: string;
  typeface?: string;
  has_logo?: boolean;
  has_cover?: boolean;
  logo_url?: string;
  cover_url?: string;
  logo_file_id?: string;
  cover_file_id?: string;
  events?: StorefrontEvent[];
  resources?: StorefrontEvent[];
  resources_upcoming?: StorefrontEvent[];
  membership_status?: string;
};

export type StorefrontParticipant = {
  id: string;
  email: string;
  display_name?: string;
  status?: "pending" | "guest" | "active" | "disabled" | string;
  invite_code?: string;
  mail_sent?: boolean;
  mail_note?: string;
  created_at?: string;
  validated_at?: string;
};

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  video: "Vidéo",
  podcast: "Podcast",
  document: "Document",
};

export function humanizeStoredFilename(name?: string | null): string {
  const raw = (name || "").trim();
  if (!raw) return "";
  const extIdx = raw.lastIndexOf(".");
  let base = extIdx > 0 ? raw.slice(0, extIdx) : raw;
  base = base.replace(/^[a-f0-9]{8,}--/i, "");
  base = base.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  if (!base) return raw;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function resourceDisplayName(ev: Pick<StorefrontEvent, "title" | "resource_filename" | "resource_type">): string {
  const title = (ev.title || "").trim();
  if (title) return title;
  return humanizeStoredFilename(ev.resource_filename) || RESOURCE_TYPE_LABELS[ev.resource_type || ""] || "Ressource";
}

export const MODALITY_LABELS: Record<string, string> = {
  presentiel: "Présentiel",
  visio: "À distance (visio)",
  async: "Ressources à votre rythme",
};

export function formatStorefrontDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function modalityLabel(modality: string | null | undefined, eventType?: string): string {
  const key = (modality || "").trim();
  if (key && MODALITY_LABELS[key]) return MODALITY_LABELS[key];
  if ((eventType || "") === "visio") return MODALITY_LABELS.visio;
  return "Format à préciser";
}

export function eventVisibilityLabel(visibility?: string, reserved?: boolean): string {
  if (visibility === "selected") return "Pour vous";
  if (visibility === "public") return "Ouvert à tous";
  if (visibility === "participants" || reserved) return "Pour les inscrits";
  return "";
}

export async function loadPublicStorefront(slug: string): Promise<StorefrontPublic> {
  const res = await fetch(`/api/public/storefront/${encodeURIComponent(slug)}`, { cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as StorefrontPublic & { detail?: string };
  if (!res.ok) {
    throw new Error(data.detail || "Page introuvable.");
  }
  return data;
}
