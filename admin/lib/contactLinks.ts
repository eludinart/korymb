/** Liens cliquables pour une fiche contact (http, mailto, tel, cartes). */

export function httpHref(raw: string | undefined | null): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("//")) return `https:${value}`;
  if (/^[\w.-]+\.[a-z]{2,}([/?#].*)?$/i.test(value)) return `https://${value}`;
  return "";
}

export function mailtoHref(email: string | undefined | null): string {
  const value = String(email || "").trim();
  if (!value || !value.includes("@")) return "";
  return `mailto:${value}`;
}

export function telHref(phone: string | undefined | null): string {
  const raw = String(phone || "").trim();
  if (!raw) return "";
  let digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  if (/^0[1-9]\d{8}$/.test(digits)) digits = `+33${digits.slice(1)}`;
  if (!digits) return "";
  return `tel:${digits}`;
}

export function mapsHref(parts: Array<string | undefined | null>): string {
  const query = parts.map((p) => String(p || "").trim()).filter(Boolean).join(" ");
  if (!query) return "";
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
