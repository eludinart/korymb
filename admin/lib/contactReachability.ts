import type { BizContact, ContactReachability } from "./business";

const FIELD_LABELS: Record<string, string> = {
  email: "Email",
  phone: "Téléphone",
  website: "Site web",
  linkedin_url: "LinkedIn",
  address: "Adresse",
  city: "Ville",
  postal_code: "Code postal",
  company: "Société",
  socials: "Réseaux",
  notes_append: "Notes (faits)",
  outreach_suggestions: "Suggestions d'approche",
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  resalib: "Resalib",
};

export function contactFieldLabel(key: string): string {
  return FIELD_LABELS[key] || key;
}

export function reachabilityTone(level: string | undefined): "ok" | "warn" | "danger" {
  if (level === "complete") return "ok";
  if (level === "partial") return "warn";
  return "danger";
}

export function reachabilityBadgeClass(level: string | undefined): string {
  switch (level) {
    case "complete":
      return "bg-emerald-100 text-emerald-900 ring-emerald-200";
    case "partial":
      return "bg-amber-100 text-amber-950 ring-amber-200";
    default:
      return "bg-red-100 text-red-900 ring-red-200";
  }
}

export function getContactReachability(contact: BizContact | null | undefined): ContactReachability {
  if (contact?.reachability) return contact.reachability;
  const email = Boolean(contact?.email?.trim());
  const phone = Boolean(contact?.phone?.trim());
  const website = Boolean(contact?.website?.trim());
  const linkedin = Boolean(contact?.linkedin_url?.trim());
  let score = 0;
  if (email) score += 30;
  if (phone) score += 25;
  if (website) score += 15;
  if (linkedin) score += 15;
  const level = email && (phone || website || linkedin) ? "complete" : email || phone || website || linkedin ? "partial" : "unreachable";
  const label = level === "complete" ? "Complet" : level === "partial" ? "Partiel" : "Injoignable";
  return { score, level, label, missing: [] };
}

export function formatProposedValue(key: string, value: unknown): string {
  if (key === "socials" && value && typeof value === "object") {
    return Object.entries(value as Record<string, string>)
      .map(([k, v]) => `${contactFieldLabel(k)}: ${v}`)
      .join(" · ");
  }
  return String(value ?? "").trim() || "—";
}

export function currentContactValue(contact: BizContact, key: string): string {
  if (key === "socials") {
    const s = contact.socials || {};
    const parts = Object.entries(s)
      .filter(([, v]) => String(v || "").trim())
      .map(([k, v]) => `${contactFieldLabel(k)}: ${v}`);
    return parts.join(" · ") || "—";
  }
  if (key === "notes_append") return "(ajout)";
  const raw = (contact as Record<string, unknown>)[key];
  return String(raw ?? "").trim() || "—";
}
