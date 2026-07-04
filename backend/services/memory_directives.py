"""Directives utilisateur explicites pour mémoriser ou effacer du contexte entreprise."""
from __future__ import annotations

import logging
import re
from typing import Any

from database import (
    _memory_context_allowed_keys,
    get_enterprise_memory,
    merge_enterprise_contexts,
    snapshot_memory_history,
)

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


def apply_user_memory_directive(message: str, *, context_key: str = "global") -> dict[str, Any] | None:
    """
    Détecte une demande explicite de mémorisation ou de suppression de contexte.
    Retourne un dict {action, key, detail} si appliqué, sinon None.
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
            snapshot_memory_history(comment="auto — directive utilisateur mémoriser")
            cur = get_enterprise_memory()
            prev = ""
            if isinstance(cur.get("contexts"), dict):
                prev = str(cur["contexts"].get(key) or "")
            line = f"- {content}"
            merged = f"{prev.rstrip()}\n{line}".strip() if prev.strip() else line
            merge_enterprise_contexts({key: merged[:8000]})
            return {"action": "remember", "key": key, "detail": content[:300]}
        except Exception:
            logger.exception("apply_user_memory_directive remember")
            return None

    if _FORGET_ALL.match(msg):
        try:
            snapshot_memory_history(comment="auto — directive utilisateur effacer contexte")
            from database import delete_enterprise_context_keys

            delete_enterprise_context_keys([key])
            return {"action": "forget_all", "key": key, "detail": ""}
        except Exception:
            logger.exception("apply_user_memory_directive forget_all")
            return None

    m = _FORGET_PHRASE.match(msg)
    if m:
        phrase = m.group(1).strip()
        if len(phrase) < 4:
            return None
        try:
            snapshot_memory_history(comment="auto — directive utilisateur supprimer phrase")
            cur = get_enterprise_memory()
            prev = ""
            if isinstance(cur.get("contexts"), dict):
                prev = str(cur["contexts"].get(key) or "")
            if not prev.strip():
                return {"action": "forget_phrase", "key": key, "detail": phrase[:300], "removed": False}
            needle = phrase.casefold()
            kept = [ln for ln in prev.splitlines() if needle not in ln.casefold()]
            new_val = "\n".join(kept).strip()
            merge_enterprise_contexts({key: new_val})
            removed = new_val != prev.strip()
            return {
                "action": "forget_phrase",
                "key": key,
                "detail": phrase[:300],
                "removed": removed,
            }
        except Exception:
            logger.exception("apply_user_memory_directive forget_phrase")
            return None

    return None
