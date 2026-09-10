/** Découpe un extrait Gmail (souvent une seule ligne) pour l'affichage. */

export function unescapeEmailText(text: string): string {
  let cur = (text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < 3; i += 1) {
    const next = cur
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/gi, "'")
      .replace(/&amp;/gi, "&");
    if (next === cur) break;
    cur = next;
  }
  return cur.trim();
}

const QUOTE_CUT =
  /\s+(Le\s+\S{2,12}\.?\s+\d{1,2}\s+\S+\.?\s+\d{4}\s+[àa]\s+\d{1,2}:\d{2}\b)/i;
const ON_WROTE_CUT = /\s+(On\s+.+?\bwrote:\s*)/i;

function formatQuoted(quoted: string): string {
  return unescapeEmailText(quoted)
    .replace(/\s*a écrit\s*:\s*/i, " a écrit :\n\n")
    .replace(/\s*wrote:\s*/i, " wrote:\n\n")
    .replace(/(Bonjour[^,\n]*,)\s+/g, "$1\n")
    .replace(/\s+(Bonjour|Bonsoir|Hello|Hi |Cher |Chère )/g, "\n\n$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function isolateDisplayedReply(text: string): { reply: string; quoted: string } {
  const raw = unescapeEmailText(text);
  if (!raw) return { reply: "", quoted: "" };

  const fr = raw.match(QUOTE_CUT);
  if (fr && fr.index && fr.index > 0) {
    return {
      reply: raw.slice(0, fr.index).trim(),
      quoted: formatQuoted(raw.slice(fr.index).trim()),
    };
  }
  const en = raw.match(ON_WROTE_CUT);
  if (en && en.index && en.index > 0) {
    return {
      reply: raw.slice(0, en.index).trim(),
      quoted: formatQuoted(raw.slice(en.index).trim()),
    };
  }

  const wroteAt = raw.search(/\ba écrit\s*:/i);
  if (wroteAt > 0) {
    const leAt = raw.search(/\sLe\s+/i);
    if (leAt > 0 && leAt < wroteAt) {
      return {
        reply: raw.slice(0, leAt).trim(),
        quoted: formatQuoted(raw.slice(leAt).trim()),
      };
    }
  }

  const nl = raw.search(/\n\s*Le\s+\S/i);
  if (nl > 0) {
    return { reply: raw.slice(0, nl).trim(), quoted: formatQuoted(raw.slice(nl).trim()) };
  }
  return { reply: raw, quoted: "" };
}
