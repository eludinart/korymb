export type OutreachDetail = { label: string; value: string };
export type OutreachAngle = { title: string; pitch: string; details: OutreachDetail[] };
export type OutreachEntry = { when: string; intro: string; body: string; angles: OutreachAngle[] };

const META = new Set([
  "accroche",
  "format",
  "canal",
  "canal prioritaire",
  "timing",
  "objection",
  "prochaine action",
  "ce qui change",
  "pourquoi",
  "offre",
  "offre / format",
]);

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const SOURCE_LABELS: Record<string, string> = {
  prospection: "Prospection",
  exploration: "Exploration",
  suggestions_avancees: "Suggestions avancées",
  agent: "Agent",
};

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clean(value: string): string {
  let text = value.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  const wrapped =
    (text.startsWith('"') && text.endsWith('"') && text.length > 1) ||
    (text.startsWith("«") && text.endsWith("»") && text.length > 1);
  if (wrapped) text = text.slice(1, -1).trim();
  return text;
}

function isMeta(label: string): boolean {
  return META.has(fold(label));
}

function formatStamp(stamp: string): string {
  const match = stamp.match(/^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}:\d{2}))?(?:\s*\(([^)]+)\))?/);
  if (!match) return stamp;
  const month = MONTHS[Number(match[2]) - 1] || match[2];
  const time = match[4] ? ` · ${match[4]}` : "";
  const rawSource = (match[5] || "").trim();
  const source = rawSource ? ` · ${SOURCE_LABELS[rawSource] || rawSource}` : "";
  return `${Number(match[3])} ${month} ${match[1]}${time}${source}`;
}

function splitBullet(line: string): { indent: number; text: string } | null {
  const match = line.match(/^(\s*)(?:[-*•]|\d+\.)\s+(.*)$/);
  if (!match) return null;
  return { indent: match[1].length, text: match[2].trim() };
}

function splitLabel(text: string): { label: string; rest: string } | null {
  const plain = text.replace(/\*\*/g, "").trim();
  const match = plain.match(/^([^:]{2,80})\s*:\s*([\s\S]*)$/);
  if (!match) return null;
  return { label: match[1].trim(), rest: match[2].trim() };
}

function beginAngle(angles: OutreachAngle[], title: string, pitch: string): OutreachAngle {
  const angle: OutreachAngle = { title: clean(title), pitch: clean(pitch), details: [] };
  angles.push(angle);
  return angle;
}

function parseBody(body: string): { intro: string; angles: OutreachAngle[] } {
  const angles: OutreachAngle[] = [];
  const intro: string[] = [];
  let current: OutreachAngle | null = null;

  for (const line of body.split("\n")) {
    if (!line.trim()) continue;
    const bullet = splitBullet(line);
    if (!bullet) {
      const text = clean(line);
      if (current === null) intro.push(text);
      else if (!current.pitch) current.pitch = text;
      else current.pitch = `${current.pitch} ${text}`;
      continue;
    }
    const labeled = splitLabel(bullet.text);
    const top = bullet.indent < 2;
    if (top && (!labeled || !isMeta(labeled.label))) {
      current = labeled
        ? beginAngle(angles, labeled.label, labeled.rest)
        : beginAngle(angles, bullet.text, "");
      continue;
    }
    if (current === null) current = beginAngle(angles, "Approche", "");
    if (labeled) current.details.push({ label: clean(labeled.label), value: clean(labeled.rest) });
    else if (current.pitch) current.pitch = `${current.pitch} ${clean(bullet.text)}`;
    else current.pitch = clean(bullet.text);
  }

  return { intro: intro.join(" "), angles: angles.filter((angle) => angle.title) };
}

export function parseOutreachSuggestions(raw: string): OutreachEntry[] {
  const text = String(raw || "").replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  const chunks: { stamp: string; lines: string[] }[] = [];
  let stamp = "";
  let lines: string[] = [];
  const flush = () => {
    if (stamp || lines.some((line) => line.trim())) chunks.push({ stamp, lines });
    lines = [];
  };

  for (const line of text.split("\n")) {
    const match = line.trim().match(/^---\s*(.+?)\s*---$/);
    if (match && !/^https?:/i.test(match[1])) {
      flush();
      stamp = match[1].trim();
      continue;
    }
    lines.push(line);
  }
  flush();

  return chunks
    .map((chunk) => {
      const body = chunk.lines.join("\n").trim();
      const parsed = parseBody(body);
      return {
        when: chunk.stamp ? formatStamp(chunk.stamp) : "",
        intro: parsed.intro,
        body,
        angles: parsed.angles,
      };
    })
    .filter((entry) => entry.body);
}
