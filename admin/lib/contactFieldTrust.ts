import type { BizContact } from "./business";
import { currentContactValue, formatProposedValue } from "./contactReachability";

const CONSUMER_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.fr",
  "live.com",
  "yahoo.fr",
  "yahoo.com",
  "orange.fr",
  "wanadoo.fr",
  "free.fr",
  "sfr.fr",
  "laposte.net",
  "proton.me",
  "protonmail.com",
  "icloud.com",
  "me.com",
]);

const JUNK_EMAIL_DOMAINS = new Set([
  "pagesjaunes.fr",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "example.com",
  "tavily.com",
  "google.com",
]);

const OWN_SITE_SUFFIXES = ["eludein.art"];
const DIRECTORY_HOSTS = [
  "pagesjaunes.fr",
  "google.com",
  "bing.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "resalib.fr",
  "doctolib.fr",
  "medoucine.com",
  "lesmedecinesdouces.fr",
  "levaretvous.com",
  "wikipedia.org",
];

function hostMatches(host: string, suffixes: string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

const STOP = new Set(["de", "la", "le", "les", "du", "des", "et", "en", "au", "aux", "cabinet", "sarl", "sas", "eurl"]);

function hostOf(urlOrEmail: string): string {
  const v = String(urlOrEmail || "").trim().toLowerCase();
  if (v.includes("@")) return v.split("@").pop() || "";
  try {
    const u = new URL(v.startsWith("http") ? v : `https://${v}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function tokensFrom(...parts: Array<string | undefined | null>): string[] {
  const blob = parts.map((p) => String(p || "")).join(" ").toLowerCase();
  return blob
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOP.has(t));
}

function distinctiveTokens(contact: BizContact): string[] {
  const tails = new Set(["corp", "ltd", "inc", "gmbh", "sas", "sarl", "eurl", "sasu"]);
  const parts = tokensFrom(contact.name);
  let family = parts;
  if (parts.length >= 2 && tails.has(parts[parts.length - 1])) family = parts.slice(0, -1);
  else if (parts.length >= 2) family = parts.slice(1);
  const companyBlob = (contact.company || "").toLowerCase();
  const companyOk = !companyBlob.includes("siret") && !companyBlob.includes("entrepreneur");
  const company = companyOk ? tokensFrom(contact.company).filter((t) => t.length >= 5 && !STOP.has(t)) : [];
  return [...family, ...company];
}

function websiteMatchesIdentity(url: string, contact: BizContact): boolean {
  const h = hostOf(url);
  if (!h) return false;
  if (hostMatches(h, OWN_SITE_SUFFIXES) || hostMatches(h, DIRECTORY_HOSTS)) return false;
  const tokens = distinctiveTokens(contact);
  if (!tokens.length) return true;
  const blob = `${h} ${url}`.toLowerCase();
  return tokens.some((t) => blob.includes(t));
}

export function enrichmentFieldCaution(contact: BizContact, key: string, proposed: unknown): string | null {
  const next = formatProposedValue(key, proposed);
  if (!next || next === "—") return null;
  const current = currentContactValue(contact, key);

  if (key === "email") {
    const domain = hostOf(next);
    if (JUNK_EMAIL_DOMAINS.has(domain)) return "adresse issue d’un annuaire / générique — à vérifier";
    const siteHost = hostOf(contact.website || "");
    if (siteHost && domain && domain !== siteHost && !CONSUMER_EMAIL_DOMAINS.has(domain)) {
      return "domaine e-mail différent du site — homonyme possible";
    }
  }

  if (key === "website") {
    const h = hostOf(next);
    if (hostMatches(h, OWN_SITE_SUFFIXES)) return "c’est le site Élude In Art — pas celui du contact";
    if (hostMatches(h, DIRECTORY_HOSTS)) return "annuaire / réseau — ce n’est pas un site officiel";
    if (!websiteMatchesIdentity(next, contact)) {
      return "le nom de domaine ne reprend pas le nom du contact — probablement faux";
    }
  }

  if (key === "linkedin_url" || key === "socials") {
    const urls =
      key === "socials" && proposed && typeof proposed === "object"
        ? Object.values(proposed as Record<string, string>)
        : [next];
    for (const url of urls) {
      if (String(url).includes("/gaming/")) return "lien Facebook gaming — probablement hors sujet";
      const tokens = distinctiveTokens(contact);
      if (tokens.length && !tokens.some((t) => String(url).toLowerCase().includes(t))) {
        return "le lien ne reprend pas le nom / la structure — homonyme possible";
      }
    }
  }

  if (key === "city" && contact.city?.trim() && current !== "—" && current.toLowerCase() !== next.toLowerCase()) {
    return "ville différente de la fiche actuelle";
  }

  if (current !== "—" && current !== next && key !== "notes_append" && key !== "outreach_suggestions") {
    return "remplace une valeur déjà présente";
  }
  return null;
}

export function defaultEnrichmentSelected(contact: BizContact, key: string, proposed: unknown): boolean {
  if (key === "notes_append" || key === "outreach_suggestions") return true;
  return enrichmentFieldCaution(contact, key, proposed) == null;
}
