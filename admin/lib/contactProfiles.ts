import type { BizContact } from "./business";

/** Profil métier (tags) — distinct de la relation CRM (prospect / client / …). */
export type ContactProfileDef = {
  key: string;
  label: string;
  /** Variantes normalisées (sans accents, minuscules) pour matcher les tags. */
  aliases: string[];
};

export const CONTACT_PROFILE_DEFS: ContactProfileDef[] = [
  { key: "coach", label: "Coach", aliases: ["coach", "coachs", "coaching"] },
  {
    key: "therapeute",
    label: "Thérapeute",
    aliases: ["therapeute", "therapeutes", "therapist", "therapists"],
  },
  {
    key: "editeur",
    label: "Éditeur",
    aliases: ["editeur", "editeurs", "edition", "maison dedition", "maison d edition"],
  },
  {
    key: "ecolieu",
    label: "Écolieu",
    aliases: ["ecolieu", "ecolieux", "sivana", "ecosysteme"],
  },
  {
    key: "facilitateur",
    label: "Facilitateur",
    aliases: ["facilitateur", "facilitateurs", "facilitation"],
  },
  {
    key: "artiste",
    label: "Artiste",
    aliases: ["artiste", "artistes", "createur", "creatrice"],
  },
  {
    key: "partenaire-terrain",
    label: "Partenaire terrain",
    aliases: ["partenaire terrain", "lieu", "lieu hebergement", "salle"],
  },
];

export function foldContactToken(raw: string): string {
  return (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tagMatchesProfile(tagFolded: string, profile: ContactProfileDef): boolean {
  if (!tagFolded) return false;
  if (tagFolded === profile.key || tagFolded === foldContactToken(profile.label)) return true;
  return profile.aliases.some((alias) => {
    const a = foldContactToken(alias);
    if (!a) return false;
    return tagFolded === a || tagFolded.includes(a) || a.includes(tagFolded);
  });
}

export function contactProfileKeys(contact: Pick<BizContact, "tags"> | null | undefined): string[] {
  const tags = (contact?.tags || []).map(foldContactToken).filter(Boolean);
  if (!tags.length) return [];
  return CONTACT_PROFILE_DEFS.filter((p) => tags.some((t) => tagMatchesProfile(t, p))).map((p) => p.key);
}

export function contactMatchesProfile(
  contact: Pick<BizContact, "tags"> | null | undefined,
  profileKey: string,
): boolean {
  if (!profileKey || profileKey === "all") return true;
  if (profileKey.startsWith("tag:")) {
    const want = foldContactToken(profileKey.slice(4));
    return (contact?.tags || []).some((t) => foldContactToken(t) === want);
  }
  return contactProfileKeys(contact).includes(profileKey);
}

/** Tags hors catalogues (affichés comme options supplémentaires). */
export function extraProfileTags(contacts: Array<Pick<BizContact, "tags">>): string[] {
  const known = new Set<string>();
  for (const p of CONTACT_PROFILE_DEFS) {
    known.add(foldContactToken(p.key));
    known.add(foldContactToken(p.label));
    for (const a of p.aliases) known.add(foldContactToken(a));
  }
  const seen = new Map<string, string>();
  for (const c of contacts) {
    for (const tag of c.tags || []) {
      const folded = foldContactToken(tag);
      if (!folded || known.has(folded)) continue;
      if (CONTACT_PROFILE_DEFS.some((p) => tagMatchesProfile(folded, p))) continue;
      if (!seen.has(folded)) seen.set(folded, tag.trim());
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b, "fr"));
}

export function toggleProfileTag(tags: string[], profileKey: string): string[] {
  const def = CONTACT_PROFILE_DEFS.find((p) => p.key === profileKey);
  if (!def) return tags;
  const has = tags.some((t) => tagMatchesProfile(foldContactToken(t), def));
  if (has) {
    return tags.filter((t) => !tagMatchesProfile(foldContactToken(t), def));
  }
  return [...tags, def.label];
}

export function tagsIncludeProfile(tags: string[], profileKey: string): boolean {
  const def = CONTACT_PROFILE_DEFS.find((p) => p.key === profileKey);
  if (!def) return false;
  return tags.some((t) => tagMatchesProfile(foldContactToken(t), def));
}
