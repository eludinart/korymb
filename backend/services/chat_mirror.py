"""Effet miroir immédiat pour le chat (réponse lite avant orchestration)."""
from __future__ import annotations

import re

from services.agents import agents_def, FLEUR_CONTEXT

_MIRROR_FALLBACK_CLOSING = (
    "Je lance l'exploration en arrière-plan — vous serez notifié dans ce fil "
    "et via la cloche dès que la synthèse est prête."
)

_SENTENCE_END = re.compile(r"[.!?…»\"]\s*$|\)\s*$")


def _line_looks_incomplete(line: str) -> bool:
    s = line.strip()
    if not s:
        return False
    if re.search(r"[:—–\-]\s*$", s):
        return True
    if s.count("(") > s.count(")"):
        return True
    if s.count("**") % 2 != 0:
        return True
    if s.startswith("*(") and not s.rstrip().endswith(")"):
        return True
    if s.startswith("(") and not s.rstrip().endswith(")"):
        return True
    if not _SENTENCE_END.search(s) and len(s) > 10:
        return True
    return False


def finalize_mirror_ack(text: str) -> str:
    """Évite les accusés de réception coupés en plein milieu (limite tokens LLM)."""
    t = (text or "").strip()
    if not t:
        return t

    if "---" in t:
        head, _, tail = t.partition("---")
        tail_s = tail.strip()
        if tail_s and _line_looks_incomplete(tail_s.split("\n")[-1]):
            t = head.strip()

    lines = [ln.rstrip() for ln in t.split("\n")]
    while lines:
        last = lines[-1].strip()
        if not last:
            lines.pop()
            continue
        if _line_looks_incomplete(last):
            lines.pop()
            continue
        break

    fixed: list[str] = []
    for i, ln in enumerate(lines):
        stripped = ln.strip()
        if stripped.endswith(":") and not re.search(r":\s+\S", stripped):
            next_is_list = i + 1 < len(lines) and re.match(r"^\s*(\d+\.|[-*•])", lines[i + 1].strip())
            fixed.append(re.sub(r":\s*$", ".", stripped) if next_is_list else re.sub(r":\s*$", ".", stripped))
        else:
            fixed.append(ln)
    t = "\n".join(fixed).strip()

    if t and not _SENTENCE_END.search(t):
        t = t.rstrip(":-— ") + "."

    tail_window = t[-320:]
    if not re.search(r"notifi|cloche|synthèse.*prête|prévenu|seras prévenu", tail_window, re.I):
        t = f"{t}\n\n{_MIRROR_FALLBACK_CLOSING}" if t else _MIRROR_FALLBACK_CLOSING

    return t.strip()


def generate_mirror_ack(message: str) -> str:
    """Accusé de réception immédiat : reformule le besoin et annonce le travail en arrière-plan."""
    msg = (message or "").strip()
    if not msg:
        return ""
    try:
        from llm_client import llm_turn

        agent_cfg = agents_def()["coordinateur"]
        system = (
            agent_cfg["system"][:900]
            + FLEUR_CONTEXT[:500]
            + "\n\nMode « accusé de réception » (avant mission en arrière-plan).\n"
            "Réponse **courte** (80 à 120 mots max), en français :\n"
            "- 1 phrase : reformulation du besoin.\n"
            "- 2 ou 3 puces « - » : ce que tu lances (pas plus).\n"
            "- 1 phrase finale complète : tâche de fond + notification chat et cloche.\n"
            "Interdit : notes de bas de page, parenthèses en italique, section « Prochaine étape » longue, "
            "séparateur ---, mention d'agents mobilisés, listes numérotées longues.\n"
            "Chaque phrase et puce doit se terminer correctement (point ou ponctuation)."
        )
        text, _, _ = llm_turn(
            system,
            msg,
            max_tokens=420,
            or_profile="lite",
            usage_context="chat:mirror_ack",
            temperature=0.35,
        )
        return finalize_mirror_ack((text or "").strip())
    except Exception:
        preview = msg[:200] + ("…" if len(msg) > 200 else "")
        return finalize_mirror_ack(
            f"Je prends en compte votre demande : *{preview}*\n\n{_MIRROR_FALLBACK_CLOSING}"
        )
