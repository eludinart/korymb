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
  autre: "Autre",
};

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
