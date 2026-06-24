/**
 * Réparation côté client des accusés de réception tronqués (messages déjà en localStorage).
 * Miroir de backend/services/chat_mirror.py::finalize_mirror_ack (version simplifiée).
 */
const SENTENCE_END = /[.!?…»")\]]\s*$/;

function lineLooksIncomplete(line: string | undefined | null): boolean {
  const s = String(line ?? "").trim();
  if (!s) return false;
  if (/[:—–-]\s*$/.test(s)) return true;
  if ((s.match(/\(/g) || []).length > (s.match(/\)/g) || []).length) return true;
  if ((s.match(/\*\*/g) || []).length % 2 !== 0) return true;
  if (s.startsWith("*(") && !s.endsWith(")")) return true;
  if (s.startsWith("(") && !s.endsWith(")")) return true;
  if (!SENTENCE_END.test(s) && s.length > 10) return true;
  return false;
}

const FALLBACK_CLOSING =
  "Je lance l'exploration en arrière-plan — vous serez notifié dans ce fil et via la cloche dès que la synthèse est prête.";

export function repairTruncatedChatBubble(text: string | undefined | null): string {
  let t = String(text ?? "").trim();
  if (!t) return t;

  const sep = t.indexOf("---");
  if (sep >= 0) {
    const head = t.slice(0, sep);
    const tail = t.slice(sep + 3);
    const tailLines = tail.trim().split("\n");
    const lastTail = tailLines[tailLines.length - 1] ?? "";
    if (tail.trim() && lineLooksIncomplete(lastTail)) {
      t = head.trim();
    }
  }

  const lines = t.split("\n").map((l) => String(l ?? "").replace(/\s+$/, ""));
  while (lines.length) {
    const last = (lines[lines.length - 1] ?? "").trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (lineLooksIncomplete(last)) {
      lines.pop();
      continue;
    }
    break;
  }

  t = lines
    .map((ln) => {
      const s = String(ln ?? "").trim();
      if (s.endsWith(":") && !/:\s+\S/.test(s)) return s.replace(/:\s*$/, ".");
      return ln;
    })
    .join("\n")
    .trim();

  if (t && !SENTENCE_END.test(t)) {
    t = `${t.replace(/[:—–-]\s*$/, "")}.`;
  }

  const tailWindow = t.slice(-320);
  if (!/notifi|cloche|synthèse.*prête|prévenu/i.test(tailWindow)) {
    t = t ? `${t}\n\n${FALLBACK_CLOSING}` : FALLBACK_CLOSING;
  }

  return t.trim();
}

/** Accusés miroir (`ack-*`) : réparer l'affichage si génération antérieure coupée. */
export function chatBubbleDisplayText(messageId: string, content: string | undefined | null): string {
  const raw = String(content ?? "");
  if (messageId.startsWith("ack-")) {
    return repairTruncatedChatBubble(raw);
  }
  return raw;
}
