/** Corps email lisible : retrait léger du Markdown (pas de HTML). */
export function markdownToPlainEmailBody(md: string): string {
  return String(md || "")
    .replace(/\r\n/g, "\n")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/^\s*\|/gm, "")
    .replace(/\|/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeEmailSubject(title: string): string {
  const t = title
    .replace(/\s*[—–-]\s*brouillon\s*$/i, "")
    .replace(/^Korymb\s*[—–-]\s*/i, "")
    .trim();
  return t ? `Korymb — ${t}` : "Korymb — livrable";
}

/**
 * Ouvre le client mail par un clic sur lien `mailto:` (évite le double encodage Gmail
 * provoqué par window.open sur certaines configurations Chrome).
 */
export function openEmailDraft(subject: string, bodyMarkdown: string, maxBody = 1800): void {
  if (typeof document === "undefined") return;

  const plain = markdownToPlainEmailBody(bodyMarkdown);
  const body =
    plain.length > maxBody
      ? `${plain.slice(0, maxBody)}\n\n[… texte tronqué — copiez le livrable complet depuis Korymb]`
      : plain;

  const params = new URLSearchParams();
  params.set("subject", normalizeEmailSubject(subject));
  params.set("body", body);

  const href = `mailto:?${params.toString()}`;
  const a = document.createElement("a");
  a.href = href;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
