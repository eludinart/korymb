import type {
  BizContact,
  BizEvent,
  BizOverview,
  BizProject,
  BizQuote,
} from "../../lib/business";

export type {
  BizContact,
  BizEvent,
  BizOverview,
  BizProject,
  BizQuote,
  QuoteLine,
} from "../../lib/business";

export { businessApi } from "../../lib/business";

export function formatEuroCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format((cents || 0) / 100);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("fr-FR", {
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

export const CONTACT_TYPE_LABELS: Record<string, string> = {
  prospect: "Prospect",
  client: "Client",
  partenaire: "Partenaire",
  autre: "Autre",
};

export const CONTACT_STATUS_LABELS: Record<string, string> = {
  active: "Actif",
  inactive: "Inactif",
  archived: "Archivé",
};

export const EVENT_STATUS_LABELS: Record<string, string> = {
  planned: "Planifié",
  confirmed: "Confirmé",
  done: "Terminé",
  cancelled: "Annulé",
};

export const INVOICE_STATUS_LABELS: Record<string, string> = {
  pending: "En attente",
  issued: "Émise",
  paid: "Payée",
  cancelled: "Annulée",
  error: "Erreur",
};

/** ISO → valeur `datetime-local`. */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO ou YYYY-MM-DD → valeur `date`. */
export function toDateInputValue(iso: string | null | undefined): string {
  if (!iso) return "";
  const raw = String(iso).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function isMatiereEvent(ev: { nature?: string; resource_type?: string; event_type?: string } | null | undefined): boolean {
  if (!ev) return false;
  return Boolean(ev.resource_type) || ev.nature === "matiere" || ev.event_type === "ressource" || ev.event_type === "jalon";
}

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  seance: "Séance",
  stage: "Stage",
  module_pro: "Module Pro",
  accompagnement: "Accompagnement",
  sivana: "SÏvåñà",
  autre: "Autre",
};

export const PROJECT_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  active: "Actif",
  on_hold: "En pause",
  completed: "Terminé",
  cancelled: "Annulé",
};

export const QUOTE_STATUS_LABELS: Record<string, string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  accepted: "Accepté",
  refused: "Refusé",
  expired: "Expiré",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  seance: "Séance",
  stage: "Stage",
  atelier: "Atelier",
  visio: "Visio",
  jalon: "Date cible — étape sans rendez-vous",
  ressource: "Document, vidéo ou podcast",
  autre: "Autre",
};

/** Libellés longs (formulaires). */
export const EVENT_NATURE_LABELS: Record<string, string> = {
  presence: "Rendez-vous — séance, atelier ou visio",
  matiere: "Contenu à ouvrir — document, vidéo ou podcast",
};

/** Libellés courts (calendrier, listes). */
export const EVENT_NATURE_SHORT_LABELS: Record<string, string> = {
  presence: "Rendez-vous",
  matiere: "Documents & vidéos",
};

export const EVENT_NATURE_HINT =
  "Les rendez-vous apparaissent dans « Mes séances ». Les documents et vidéos apparaissent dans « Mes ressources ».";

export const EVENT_TYPE_HINT =
  "Pour un fichier à partager, choisissez « Document, vidéo ou podcast ». Une date cible est un rappel au calendrier, sans séance.";

const PRESENCE_EVENT_TYPES = ["seance", "stage", "atelier", "visio", "autre"];
const MATIERE_EVENT_TYPES = ["ressource", "jalon", "autre"];

export function eventTypeOptionsForNature(nature: string): string[] {
  return nature === "matiere" ? [...MATIERE_EVENT_TYPES] : [...PRESENCE_EVENT_TYPES];
}

export function coerceEventTypeForNature(nature: string, eventType: string): string {
  const allowed = eventTypeOptionsForNature(nature);
  if (allowed.includes(eventType)) return eventType;
  return nature === "matiere" ? "ressource" : "seance";
}

export const EVENT_RESOURCE_TYPE_LABELS: Record<string, string> = {
  video: "Vidéo",
  podcast: "Podcast",
  document: "Document",
};

export const EVENT_MODALITY_LABELS: Record<string, string> = {
  presentiel: "Présentiel",
  visio: "À distance (visio)",
  async: "À consulter en autonomie (vidéo, podcast, document)",
};

export type EventVisibility = "internal" | "selected" | "participants" | "public";

export const EVENT_VISIBILITY_LABELS: Record<EventVisibility, string> = {
  internal: "Interne",
  selected: "Participants choisis",
  participants: "Tous les inscrits",
  public: "Public (sans compte)",
};

export const EVENT_VISIBILITY_OPTIONS: { id: EventVisibility; label: string; hint: string }[] = [
  { id: "internal", label: "Interne", hint: "Visible seulement dans le planning Korymb." },
  { id: "selected", label: "Participants choisis", hint: "Uniquement les comptes participants cochés (pas les fiches CRM)." },
  { id: "participants", label: "Tous les inscrits", hint: "Tous les participants actifs (inscription validée ou invitation acceptée)." },
  { id: "public", label: "Public", hint: "Vitrine, même sans compte — non inscrits inclus." },
];

export function visibilityFromEvent(ev: { visibility?: string; is_public?: boolean } | null | undefined): EventVisibility {
  const raw = (ev?.visibility || "").trim();
  if (raw === "internal" || raw === "selected" || raw === "participants" || raw === "public") return raw;
  return ev?.is_public ? "participants" : "internal";
}

export const INTERACTION_TYPE_LABELS: Record<string, string> = {
  prospection: "Prospection",
  email: "Email",
  call: "Appel",
  meeting: "Rendez-vous",
  note: "Note",
  quote: "Devis",
  mission: "Mission agent",
  other: "Autre",
};

export function contactLabel(c: BizContact | undefined, id: string | null | undefined, contacts: BizContact[]): string {
  if (!id) return "—";
  const found = c || contacts.find((x) => x.id === id);
  return found?.name || id.slice(0, 8);
}

export function projectLabel(p: BizProject | undefined, id: string | null | undefined, projects: BizProject[]): string {
  if (!id) return "—";
  const found = p || projects.find((x) => x.id === id);
  return found?.title || id.slice(0, 8);
}

export type { BizOverview as OverviewStats };
