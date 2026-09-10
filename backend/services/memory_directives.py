"""Directives utilisateur explicites pour mémoriser ou effacer du contexte entreprise."""
from __future__ import annotations

import logging
import re
from typing import Any

from database import _memory_context_allowed_keys

logger = logging.getLogger(__name__)

_REMEMBER = re.compile(
    r"^(?:mémorise|memorise|retiens|enregistre)(?:\s+(?:que|ça|cela|dans la mémoire))?\s*[:.]?\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)
_FORGET_ALL = re.compile(
    r"^(?:oublie|supprime|efface)(?:\-(?:moi|le))?\s+(?:tout|le contexte|la mémoire|ce contexte)"
    r"(?:\s+(?:global(?:e)?|entreprise))?\s*\.?$",
    re.IGNORECASE,
)
_FORGET_PHRASE = re.compile(
    r"^(?:oublie|supprime|efface)(?:\s+(?:de la mémoire|le contexte|cela|ça))?\s*[:.]?\s*(.+)$",
    re.IGNORECASE | re.DOTALL,
)


def _resolve_context_key(raw: str | None) -> str:
    key = (raw or "global").strip().lower()
    allowed = _memory_context_allowed_keys()
    return key if key in allowed else "global"


def _propose(
    *,
    action: str,
    key: str,
    detail: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any] | None:
    from services.memory_inbox import propose_memory_suggestion

    memory_keys: dict[str, str] = {}
    if action == "remember" and detail:
        memory_keys[key] = f"- {detail}"
    title = {
        "remember": "Mémoriser (chat)",
        "forget_all": "Effacer un volet mémoire (chat)",
        "forget_phrase": "Retirer une phrase mémoire (chat)",
    }.get(action, "Mémoire (chat)")
    extra_payload = {
        "memory_directive": {"action": action, "key": key, "detail": detail[:800]},
        **(extra or {}),
    }
    sug = propose_memory_suggestion(
        title=title,
        learnings=[detail[:240] or action],
        suggested_memory_keys=memory_keys,
        source="chat_directive",
        notify=True,
        allow_auto_apply=False,
        extra_payload=extra_payload,
    )
    out: dict[str, Any] = {"action": action, "key": key, "detail": detail[:300], "pending": True}
    if sug:
        out["suggestion_id"] = sug.get("id")
    if extra:
        out.update(extra)
    return out


def apply_user_memory_directive(message: str, *, context_key: str = "global") -> dict[str, Any] | None:
    """
    Détecte une demande explicite de mémorisation ou de suppression.
    Crée une proposition Décisions (pas d'écriture immédiate).
    """
    msg = (message or "").strip()
    if not msg or len(msg) > 4000:
        return None

    key = _resolve_context_key(context_key)

    m = _REMEMBER.match(msg)
    if m:
        content = m.group(1).strip()
        if len(content) < 4:
            return None
        try:
            return _propose(action="remember", key=key, detail=content)
        except Exception:
            logger.exception("apply_user_memory_directive remember")
            return None

    if _FORGET_ALL.match(msg):
        try:
            return _propose(action="forget_all", key=key, detail=f"effacer le volet {key}")
        except Exception:
            logger.exception("apply_user_memory_directive forget_all")
            return None

    m = _FORGET_PHRASE.match(msg)
    if m:
        phrase = m.group(1).strip()
        if len(phrase) < 4:
            return None
        try:
            return _propose(
                action="forget_phrase",
                key=key,
                detail=phrase,
                extra={"removed": None},
            )
        except Exception:
            logger.exception("apply_user_memory_directive forget_phrase")
            return None

    return None
