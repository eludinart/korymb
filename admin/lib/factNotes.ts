export type FactNote = { label: string | null; value: string };

function isFactLabel(label: string): boolean {
  const text = label.trim();
  if (text.length < 2 || text.length > 48) return false;
  if (!/^[A-ZÀ-Ÿ0-9]/.test(text)) return false;
  if (/[.!?]/.test(text)) return false;
  return text.split(/\s+/).length <= 6;
}

function asFact(chunk: string): FactNote {
  const plain = chunk.replace(/^[-*•]\s+/, "").trim();
  const match = plain.match(/^([^:\n]{2,60}?)\s*:\s+([\s\S]+)$/);
  if (!match || !isFactLabel(match[1])) return { label: null, value: plain };
  return { label: match[1].trim(), value: match[2].trim() };
}

function explodeSentences(fact: FactNote): FactNote[] {
  const parts = fact.value.split(/(?<=[A-Za-zÀ-ÿ0-9)]{2}\.)\s+(?=[A-ZÀ-Ÿ0-9])/);
  if (parts.length < 2) return [fact];
  const [first, ...rest] = parts;
  return [{ label: fact.label, value: first.trim() }, ...rest.map((part) => asFact(part.trim()))];
}

/** Découpe un bloc « Label : valeur » (lignes ou phrases collées) en faits lisibles. */
export function parseFactNotes(raw: string): FactNote[] {
  let text = String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\*\*/g, "")
    .trim();
  if (!text) return [];
  text = text.replace(/([.!?])[ \t]+(?=[A-ZÀ-Ÿ][^:\n]{1,48}:\s)/g, "$1\n");
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(asFact)
    .flatMap(explodeSentences);
}
