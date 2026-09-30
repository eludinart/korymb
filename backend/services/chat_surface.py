"""Restitution chat : masque la cuisine inter-agents et les fuites de mémoire interne."""
from __future__ import annotations

import re

from services.mission_labels import resolve_mission_id_refs_in_text

_CHAT_DROP_SECTIONS = re.compile(
    r"(?ms)^##\s+(?:Réponses\s+des\s+rôles|Livrables\s+bruts|QUESTIONS\s+STRATÉGIQUES|Questions\s+pour\s+la\s+suite).*$"
)
_CHAT_DROP_QUESTIONS_INLINE = re.compile(
    r"(?ms)^(?:#{1,3}\s*)?Questions\s+pour\s+la\s+suite\s*\n(?:\s*\d+\.\s+.+\n?)+"
)
_KORYMB_QCM_FENCE = re.compile(r"(?ms)```korymb-qcm\s*\n.*?```")
_CLARIFYING_JSON_HINT = re.compile(
    r'(?is)"clarifying_questions"\s*:\s*\[[^\]]*\]',
)
_LIVRABLE_ANNEX = re.compile(r"(?ms)\n####\s+LIVRABLE.*$")
_MEMOIRE_ENTREPRISE = re.compile(
    r"(?ms)(?:^|\n)---\s*Mémoire entreprise.*?---\s*Fin mémoire entreprise\s*---"
)
_HISTORIQUE_MISSIONS = re.compile(
    r"(?ms)(?:^|\n)---\s*Historique missions.*?---\s*Fin historique missions\s*---"
)
_ACTIVE_MEMORY = re.compile(r"(?ms)(?:^|\n)###\s*Active Memory Skill\b.*")
_REPRISE_HEADER = re.compile(
    r"(?ms)(?:^|\n)\s*\[Reprise[^\]]*\][^\n]*\n(?:\s*[-*•][^\n]*\n)*"
)
_CONTEXTE_GLOBAL = re.compile(
    r"(?ms)(?:^|\n)\s*\*{0,2}Contexte global(?:\s+entreprise)?\*{0,2}\s*:.*?(?=\n\s*\[Reprise|\n\s*#{1,3}\s|\n\s*\n[A-ZÀ-Ü]|\Z)"
)
_CONSULT_HIST_LINE = re.compile(
    r"(?m)^\s*.*(?:je consulte|consultation de)\s+l['']historique.*\n?",
    re.IGNORECASE,
)


def surface_chat_result(raw: str | None, *, keep_questionnaire: bool = False) -> str:
    """Payload visible dans le chat — synthèse actionnable sans détail orchestration."""
    if not raw or not str(raw).strip():
        return (raw or "").strip()
    text = str(raw).strip()
    text = _CHAT_DROP_SECTIONS.sub("", text).strip()
    text = _CHAT_DROP_QUESTIONS_INLINE.sub("", text).strip()
    if not keep_questionnaire:
        text = _KORYMB_QCM_FENCE.sub("", text).strip()
        text = _CLARIFYING_JSON_HINT.sub('"clarifying_questions": []', text)
    text = _LIVRABLE_ANNEX.sub("", text).strip()
    text = _MEMOIRE_ENTREPRISE.sub("", text).strip()
    text = _HISTORIQUE_MISSIONS.sub("", text).strip()
    text = _ACTIVE_MEMORY.sub("", text).strip()
    text = _CONTEXTE_GLOBAL.sub("", text).strip()
    text = _REPRISE_HEADER.sub("", text).strip()
    text = _CONSULT_HIST_LINE.sub("", text).strip()
    text = resolve_mission_id_refs_in_text(text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or str(raw).strip()
