/**
 * Le CIO renvoie parfois tout le markdown sur une seule ligne (sans \n entre sections).
 * On insère des sauts de ligne pour que remark / react-markdown produisent paragraphes et listes.
 */
export function normalizeLooseMarkdown(raw: string): string {
  let s = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!s.trim()) return "";

  const transforms: ((x: string) => string)[] = [
    (x) => x.replace(/([^\n#])(#{1,6}\s)/g, "$1\n\n$2"),
    (x) => x.replace(/(\*\*[^*]+\*\*)\s+(\*\*(?:\d+\.\s|[A-ZÀ-Ÿ]))/g, "$1\n\n$2"),
    (x) => x.replace(/([*A-Za-zÀ-ÿ0-9)\]])\s*(\*\*\d+\.\s+)/gu, "$1\n\n$2"),
    (x) => x.replace(/([^\n])\s*(\*\s+\*\*)/g, "$1\n$2"),
    (x) => x.replace(/([.!?])\s+-\s+(\*\*|[A-ZÀ-Ÿ])/g, "$1\n- $2"),
  ];

  for (let pass = 0; pass < 8; pass++) {
    const before = s;
    for (const fn of transforms) {
      s = fn(s);
    }
    if (s === before) break;
  }

  return s.replace(/\n{4,}/g, "\n\n\n").trim();
}

/** Aperçu liste / titres : retire le gras markdown pour une ligne lisible. */
export function stripMarkdownLight(raw: string): string {
  return String(raw || "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
