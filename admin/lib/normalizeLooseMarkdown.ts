/**
 * Le CIO renvoie parfois tout le markdown sur une seule ligne (sans \n entre sections).
 * On insère des sauts de ligne pour que remark / react-markdown produisent paragraphes et listes.
 */
export function normalizeLooseMarkdown(raw: string): string {
  let s = String(raw ?? "").replace(/\r\n/g, "\n");
  if (!s.trim()) return "";
  s = tryFormatStructuredPayload(s);

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

function tryFormatStructuredPayload(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "";
  const direct = parseJsonSafe(trimmed);
  if (direct !== null) return renderStructuredValue(direct).trim() || input;

  // Cas fréquent: bloc ```json ... ``` dans un texte.
  const fenced = extractFencedJson(trimmed);
  if (fenced) {
    const parsed = parseJsonSafe(fenced);
    if (parsed !== null) return renderStructuredValue(parsed).trim() || input;
  }

  // Cas mixte: texte + JSON brut collé. On tente d'extraire le plus grand objet/tableau.
  const embedded = extractFirstJsonBlock(trimmed);
  if (embedded) {
    const parsed = parseJsonSafe(embedded);
    if (parsed !== null) {
      const formatted = renderStructuredValue(parsed).trim();
      if (!formatted) return input;
      return trimmed.replace(embedded, `\n\n${formatted}\n\n`).trim();
    }
  }

  return input;
}

function renderStructuredValue(value: unknown, depth = 0): string {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    const lines = value
      .map((item) => {
        const rendered = renderStructuredValue(item, depth + 1).trim();
        if (!rendered) return "";
        const indented = rendered.includes("\n") ? `\n${indentBlock(rendered, "  ")}` : rendered;
        return `- ${indented}`;
      })
      .filter(Boolean);
    return lines.join("\n");
  }

  const obj = value as Record<string, unknown>;
  const entries = Object.entries(obj);
  const lines: string[] = [];

  for (const [rawKey, rawVal] of entries) {
    const key = humanizeKey(rawKey);
    const rendered = renderStructuredValue(rawVal, depth + 1).trim();
    if (!rendered) continue;

    const preferHeader = depth === 0 || rawKey === "next_steps" || rawKey === "steps";
    if (preferHeader) {
      const level = depth === 0 ? "##" : "###";
      lines.push(`${level} ${key}`);
      lines.push(rendered);
      continue;
    }

    const isLong = rendered.includes("\n");
    if (isLong) {
      lines.push(`- **${key}**`);
      lines.push(indentBlock(rendered, "  "));
    } else {
      lines.push(`- **${key}**: ${rendered}`);
    }
  }

  return lines.join("\n\n");
}

function humanizeKey(key: string): string {
  const clean = String(key || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "Section";
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function parseJsonSafe(raw: string): unknown | null {
  const t = raw.trim();
  const seemsJson = (t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"));
  if (!seemsJson) return null;
  try {
    return JSON.parse(t) as unknown;
  } catch {
    return null;
  }
}

function extractFencedJson(raw: string): string | null {
  const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (!match) return null;
  return match[1]?.trim() || null;
}

function extractFirstJsonBlock(raw: string): string | null {
  const startCandidates = [raw.indexOf("{"), raw.indexOf("[")].filter((n) => n >= 0);
  if (!startCandidates.length) return null;
  const start = Math.min(...startCandidates);

  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }

  return null;
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
